/* Patata Clipboard V2 - Final Polish */

/* --- DATABASE --- */
const dbName = "PatataDB_V2";
const storeName = "mediaStore";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName))
        db.createObjectStore(storeName);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}
async function saveInDB(id, blob) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej();
  });
}
async function getFromDB(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej();
  });
}
async function delFromDB(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej();
  });
}

function getAudioCover(blob) {
  return new Promise((resolve) => {
    if (!window.jsmediatags) {
      resolve(null);
      return;
    }
    window.jsmediatags.read(blob, {
      onSuccess: function (tag) {
        const tags = tag.tags;
        if (tags.picture) {
          const { data, format } = tags.picture;
          let base64String = "";
          for (let i = 0; i < data.length; i++) {
            base64String += String.fromCharCode(data[i]);
          }
          const url = `data:${format};base64,${window.btoa(base64String)}`;
          resolve(url);
        } else {
          resolve(null);
        }
      },
      onError: function (error) {
        resolve(null);
      },
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // State
  let currentUser = localStorage.getItem("patataUser") || null;
  let folders = [];
  try {
    folders = JSON.parse(localStorage.getItem("patataFolders") || "[]");
  } catch (e) {
    folders = [];
  }
  let activeFolderId = null;
  let activeItemId = null; // For tracking selected item to download

  // Elements
  const grid = document.getElementById("folderGrid");
  const addBtn = document.getElementById("addFolderBtn");
  const folderTemplate = document.getElementById("folderTemplate");
  const nameModal = document.getElementById("nameModal");
  const modal = document.getElementById("folderContentOverlay");
  const modalTitle = document.getElementById("currentFolderTitle");
  const contentArea = document.getElementById("contentArea");
  const closeBtn = document.getElementById("globalCloseBtn");
  const downloadItemBtn = document.getElementById("downloadItemBtn");

  // Tools
  const tools = {
    img: document.getElementById("uploadImage"),
    vid: document.getElementById("uploadVideo"),
    aud: document.getElementById("uploadAudio"),
    file: document.getElementById("uploadFile"), // Generic file
    text: document.getElementById("addTextBtn"),
    txtFile: document.getElementById("uploadTxt"),
    cover: document.getElementById("setCover"),
    del: document.getElementById("deleteFolderBtn"),
    removeCover: document.getElementById("removeCoverBtn"),
  };

  const init = async () => {
    if (!currentUser) {
      nameModal.classList.remove("hidden");
      document.getElementById("saveNameBtn").onclick = () => {
        const val = document.getElementById("userNameInput").value;
        if (val) {
          currentUser = val;
          localStorage.setItem("patataUser", val);
          nameModal.classList.add("hidden");
          document.getElementById("userDisplay").textContent = val;
        }
      };
    } else {
      document.getElementById("userDisplay").textContent = currentUser;
    }

    // --- Auto-create folder from URL "idea" parameter ---
    const urlParams = new URLSearchParams(window.location.search);
    const ideaName = urlParams.get('idea');
    if (ideaName) {
      const existing = folders.find(f => f.title.toLowerCase() === ideaName.toLowerCase());
      if (!existing) {
        folders.push({
          id: Date.now(),
          title: ideaName,
          content: []
        });
        save();
      }
    }

    renderGrid();
  };

  const save = () =>
    localStorage.setItem("patataFolders", JSON.stringify(folders));

  const renderGrid = async () => {
    const exist = grid.querySelectorAll(".folder-container");
    exist.forEach((e) => e.remove());

    for (const f of folders) {
      const clone = folderTemplate.content.cloneNode(true);
      const el = clone.querySelector(".folder-container");
      const nameEl = clone.querySelector(".folder-name");
      const coverImg = clone.querySelector(".cover-image");
      const stack = clone.querySelector(".items-stack");

      el.dataset.id = f.id;
      nameEl.textContent = f.title;

      // Load Cover
      if (f.coverId) {
        try {
          const blob = await getFromDB(f.coverId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            coverImg.style.backgroundImage = `url(${url})`;
            coverImg.classList.remove("hidden");
          }
        } catch (e) { }
      }

      // Stack Preview (Logic Improved for Visibility)
      if (f.content && f.content.length > 0) {
        const itemsToShow = f.content.slice(0, 3);
        for (let i = 0; i < itemsToShow.length; i++) {
          const item = itemsToShow[i];
          const paper = document.createElement("div");
          paper.className = "paper-preview";

          if (item.type === "text") {
            paper.classList.add("text-paper");
            paper.innerHTML = '<span style="font-size:1.2rem">📄</span>';
          } else if (item.type === "image" && item.fileId) {
            getFromDB(item.fileId).then((blob) => {
              if (blob) {
                paper.style.backgroundImage = `url(${URL.createObjectURL(
                  blob,
                )})`;
                paper.classList.add("media-paper");
              }
            });
          } else {
            paper.innerHTML =
              item.type === "video"
                ? "🎥"
                : item.type === "audio"
                  ? "🎵"
                  : "📎";
          }

          // Improved Centering & Rotation
          const rot = Math.random() * 10 - 5;
          paper.style.transform = `translateX(-50%) rotate(${rot}deg)`;
          paper.style.left = "50%"; // Center
          paper.style.bottom = `${i * 3}px`; // Slight vertical stack
          paper.style.zIndex = i;

          stack.appendChild(paper);
        }
      }

      nameEl.addEventListener("blur", () => {
        f.title = nameEl.textContent;
        save();
      });
      nameEl.addEventListener("click", (e) => e.stopPropagation());

      grid.insertBefore(clone, addBtn);
    }
  };

  // Global Click Delegation (Robust)
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".folder-container");
    if (card && !e.target.classList.contains("folder-name")) {
      const id = parseInt(card.dataset.id);
      openManager(id);
    }
  });

  addBtn.addEventListener("click", () => {
    folders.push({ id: Date.now(), title: "Nueva Carpeta", content: [] });
    save();
    renderGrid();
  });

  // --- Manager Logic ---
  const openManager = async (id) => {
    activeFolderId = id;
    const f = folders.find((x) => x.id === id);
    if (!f) return;

    modalTitle.textContent = f.title;
    modal.classList.remove("hidden");

    if (f.coverId) tools.removeCover.classList.remove("hidden");
    else tools.removeCover.classList.add("hidden");

    renderContent(f);
  };

  const closeManager = () => {
    activeFolderId = null;
    activeItemId = null; // Reset selection
    downloadItemBtn.classList.add("hidden"); // Hide download button
    modal.classList.add("hidden");
    renderGrid();
  };
  closeBtn.onclick = closeManager;

  const renderContent = async (f) => {
    contentArea.innerHTML = "";
    downloadItemBtn.classList.add("hidden"); // Hide on render
    activeItemId = null; // Reset on render

    if (!f.content || f.content.length === 0) {
      contentArea.innerHTML = `<div style="width:100%; text-align:center; color:rgba(255,255,255,0.2); margin-top:50px;">
                <div style="font-size:3rem; margin-bottom:10px">📭</div>
                Carpeta vacía
            </div>`;
      return;
    }

    for (let i = 0; i < f.content.length; i++) {
      const item = f.content[i];
      const div = document.createElement("div");
      div.className = "content-item";
      const uniqueId = item.fileId || item.date; // Use fileId if available, otherwise date
      div.dataset.id = uniqueId;

      let html = `<span>${item.type}</span>`;

      if (item.type === "text") {
        html = `<p>${item.text}</p>`;
      } else if (item.type === "file") {
        html = `<div class="audio-wrapper"><div class="audio-art">📎</div><p style="text-align:center; word-break:break-all;">${item.name || "Archivo"
          }</p></div>`;
      } else if (item.fileId) {
        const blob = await getFromDB(item.fileId);
        if (blob) {
          const url = URL.createObjectURL(blob);

          if (item.type === "image") {
            html = `<img src="${url}">`;
          } else if (item.type === "video") {
            html = `<video src="${url}" controls></video>`;
          } else if (item.type === "audio") {
            html = `<div class="audio-wrapper">
                                    <div class="audio-art" id="art_${item.fileId
              }">🎵</div>
                                     <p style="text-align:center; font-size: 0.8em;">${item.name
              }</p>
                                    <audio src="${url}" controls></audio>
                                </div>`;
            getAudioCover(blob).then((artUrl) => {
              if (artUrl) {
                const artEl = document.getElementById(`art_${item.fileId}`);
                if (artEl) {
                  artEl.style.backgroundImage = `url(${artUrl})`;
                  artEl.textContent = "";
                }
              }
            });
          }
        }
      }

      div.innerHTML = html;

      // Selection logic
      div.addEventListener("click", () => {
        if (!item.fileId) return; // Not selectable if not a file

        // Deselect others
        contentArea
          .querySelectorAll(".content-item.selected")
          .forEach((el) => el.classList.remove("selected"));

        // Select this one
        div.classList.add("selected");
        activeItemId = uniqueId;
        downloadItemBtn.classList.remove("hidden");
      });

      const del = document.createElement("button");
      del.className = "delete-btn-item";
      del.innerHTML = "&times;";
      del.onclick = async (e) => {
        e.stopPropagation(); // Prevent selection when deleting
        if (item.fileId) await delFromDB(item.fileId);
        f.content.splice(i, 1);
        save();
        renderContent(f); // Re-render to reflect deletion
      };
      div.appendChild(del);

      contentArea.appendChild(div);
    }
  };

  // --- Tools ---

  tools.removeCover.onclick = async () => {
    const f = folders.find((x) => x.id === activeFolderId);
    if (f && f.coverId) {
      await delFromDB(f.coverId);
      f.coverId = null;
      save();
      alert("Portada eliminada");
      tools.removeCover.classList.add("hidden");
    }
  };

  const handleFile = (input, type) => {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file || !activeFolderId) return;
      const f = folders.find((x) => x.id === activeFolderId);

      if (type === "cover") {
        const coverId = `cov_${f.id}_${Date.now()}`;
        await saveInDB(coverId, file);
        if (f.coverId) await delFromDB(f.coverId);
        f.coverId = coverId;
        alert("Portada actualizada!");
        tools.removeCover.classList.remove("hidden");
      } else {
        const fileId = `file_${Date.now()}`;
        await saveInDB(fileId, file);
        f.content.push({
          type,
          fileId,
          name: file.name,
          date: Date.now(),
        });
      }
      save();
      renderContent(f);
      input.value = "";
    };
  };

  handleFile(tools.img, "image");
  handleFile(tools.vid, "video");
  handleFile(tools.aud, "audio");
  handleFile(tools.file, "file"); // Handle generic file
  handleFile(tools.cover, "cover");

  tools.txtFile.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeFolderId) return;
    const text = await file.text();
    const f = folders.find((x) => x.id === activeFolderId);
    f.content.push({ type: "text", text: text, fromFile: file.name });
    save();
    renderContent(f);
    e.target.value = "";
  };

  tools.text.onclick = () => {
    const t = prompt("Escribe tu nota:");
    if (t && activeFolderId) {
      const f = folders.find((x) => x.id === activeFolderId);
      f.content.push({ type: "text", text: t });
      save();
      renderContent(f);
    }
  };

  tools.del.onclick = async () => {
    if (confirm("¿Borrar carpeta? (Irreversible)")) {
      const f = folders.find((x) => x.id === activeFolderId);
      if (f.coverId) await delFromDB(f.coverId);
      for (const c of f.content) if (c.fileId) await delFromDB(c.fileId);

      folders = folders.filter((x) => x.id !== activeFolderId);
      save();
      closeManager();
    }
  };

  // --- DOWNLOAD LOGIC ---
  downloadItemBtn.addEventListener("click", async () => {
    if (!activeFolderId || !activeItemId) return;

    const folder = folders.find((f) => f.id === activeFolderId);
    const item = folder.content.find(
      (c) => (c.fileId || c.date) == activeItemId,
    );

    if (item && item.fileId) {
      try {
        const blob = await getFromDB(item.fileId);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = item.name || "download"; // Use stored name
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error("Download failed:", error);
        alert("No se pudo descargar el archivo.");
      }
    }
  });

  /* --- ROBUST BINARY SHARING LOGIC --- */

  // UI elements
  const importFolderBtn = document.getElementById("importFolderBtn");
  const exportFolderBtn = document.getElementById("exportFolderBtn");
  const importModal = document.getElementById("importModal");
  const exportModal = document.getElementById("exportModal");
  const closeImportModalBtn = document.getElementById("closeImportModalBtn");
  const closeExportModalBtn = document.getElementById("closeExportModalBtn");
  const executeImportBtn = document.getElementById("executeImportBtn");
  const copyExportCodeBtn = document.getElementById("copyExportCodeBtn");
  const downloadShareFileBtn = document.getElementById("downloadShareFileBtn");
  const exportDataEl = document.getElementById("exportData");
  const importDataEl = document.getElementById("importData");
  const importFileEl = document.getElementById("importFile");

  // Helper: Blob to Base64 (Only for small payloads)
  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Helper: Base64 to Blob
  const base64ToBlob = async (base64) => {
    const res = await fetch(base64);
    return await res.blob();
  };

  // Binary Packager: Creates a .patata binary package
  const createBinaryPackage = async (folder) => {
    const manifest = {
      title: folder.title,
      items: [],
      coverSize: 0,
    };
    const blobs = [];

    if (folder.coverId) {
      const b = await getFromDB(folder.coverId);
      if (b) {
        manifest.coverSize = b.size;
        blobs.push(b);
      }
    }

    for (const item of folder.content) {
      const mItem = { ...item };
      if (item.fileId) {
        const b = await getFromDB(item.fileId);
        if (b) {
          mItem.fileSize = b.size;
          blobs.push(b);
        }
      }
      manifest.items.push(mItem);
    }

    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new ArrayBuffer(4);
    new DataView(header).setUint32(0, manifestBytes.byteLength);

    const rawBlob = new Blob([header, manifestBytes, ...blobs]);
    const compressedStream = rawBlob.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(compressedStream).blob();
  };

  // Binary Unpackager: Reads a .patata binary package
  const unpackBinaryPackage = async (gzipBlob) => {
    try {
      const decompressedStream = gzipBlob.stream().pipeThrough(new DecompressionStream("gzip"));
      const rawBlob = await new Response(decompressedStream).blob();

      const headerBlob = rawBlob.slice(0, 4);
      const headerBuf = await headerBlob.arrayBuffer();
      const manifestLen = new DataView(headerBuf).getUint32(0);

      const manifestBlob = rawBlob.slice(4, 4 + manifestLen);
      const manifestText = await manifestBlob.text();
      const manifest = JSON.parse(manifestText);

      const newFolder = {
        id: Date.now(),
        title: manifest.title || "Carpeta Importada",
        content: [],
        coverId: null,
      };

      let offset = 4 + manifestLen;

      if (manifest.coverSize > 0) {
        const coverBlob = rawBlob.slice(offset, offset + manifest.coverSize);
        offset += manifest.coverSize;
        const coverId = `cov_${newFolder.id}_${Date.now()}`;
        await saveInDB(coverId, coverBlob);
        newFolder.coverId = coverId;
      }

      for (const mItem of manifest.items) {
        const item = { ...mItem };
        if (mItem.fileSize > 0) {
          const fileBlob = rawBlob.slice(offset, offset + mItem.fileSize);
          offset += mItem.fileSize;
          const fileId = `file_${Date.now()}_${Math.random()}`;
          await saveInDB(fileId, fileBlob);
          item.fileId = fileId;
        }
        newFolder.content.push(item);
      }

      folders.push(newFolder);
      save();
      await renderGrid();
      return true;
    } catch (e) {
      console.error("Unpack Error:", e);
      return false;
    }
  };

  // Export Button Handler
  exportFolderBtn.addEventListener("click", async () => {
    if (!activeFolderId) return;
    const folder = folders.find((f) => f.id === activeFolderId);
    if (!folder) return;

    alert("Generando paquete para compartir... ¡Es más rápido y ligero!");

    try {
      const packageBlob = await createBinaryPackage(folder);
      exportModal.classList.remove("hidden");

      if (packageBlob.size < 5 * 1024 * 1024) {
        const base64 = await blobToBase64(packageBlob);
        exportDataEl.value = base64.substring(base64.indexOf(",") + 1);
        copyExportCodeBtn.disabled = false;
        copyExportCodeBtn.textContent = "Copiar Código";
      } else {
        exportDataEl.value = "--- Esta carpeta es demasiado grande para un código textual. Por favor, usa el botón de 'Descargar Archivo' de abajo para compartirla con seguridad. ---";
        copyExportCodeBtn.disabled = true;
        copyExportCodeBtn.textContent = "Usa Descarga";
      }

      downloadShareFileBtn.onclick = () => {
        const url = URL.createObjectURL(packageBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${folder.title.replace(/\s+/g, "_")}.patata`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    } catch (err) {
      console.error(err);
      alert("Error al preparar la carpeta.");
    }
  });

  // Import Button Handler
  importFolderBtn.addEventListener("click", () => {
    importModal.classList.remove("hidden");
  });

  executeImportBtn.addEventListener("click", async () => {
    const code = importDataEl.value.trim();
    if (!code || code.startsWith("---")) {
      alert("Por favor, pega un código válido.");
      return;
    }

    try {
      const blob = await base64ToBlob("data:application/gzip;base64," + code);
      const success = await unpackBinaryPackage(blob);
      if (success) {
        alert("¡Carpeta importada con éxito!");
        importModal.classList.add("hidden");
        importDataEl.value = "";
      } else {
        alert("El código es inválido.");
      }
    } catch (e) {
      alert("Error al procesar el código.");
    }
  });

  importFileEl.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const success = await unpackBinaryPackage(file);
      if (success) {
        alert("¡Archivo importado con éxito!");
        importModal.classList.add("hidden");
        importFileEl.value = "";
      } else {
        alert("El archivo no es válido.");
      }
    } catch (e) {
      alert("Error al procesar el archivo.");
    }
  };

  // Modal controls
  closeImportModalBtn.onclick = () => importModal.classList.add("hidden");
  closeExportModalBtn.onclick = () => exportModal.classList.add("hidden");

  copyExportCodeBtn.onclick = () => {
    exportDataEl.select();
    document.execCommand("copy");
    alert("¡Código copiado!");
  };

  // --- External Permission Listener ---
  // Escucha mensajes de la página oficial para crear o abrir carpetas
  window.addEventListener("message", async (event) => {
    // Solo permitimos mensajes de la fuente oficial
    if (!event.origin.startsWith("https://demi1codex.github.io")) return;

    const { type, folderName, name } = event.data || {};
    const targetName = folderName || name || (typeof event.data === 'string' ? event.data : null);

    if (targetName) {
      // Buscar si ya existe una carpeta con ese nombre
      const existing = folders.find((f) => f.title === targetName);

      if (existing) {
        // Si existe, simplemente la abrimos
        openManager(existing.id);
        console.log(`[Patata] Carpeta "${targetName}" ya existe. Abriendo...`);
      } else {
        // Si no existe, la creamos y luego la abrimos
        const newFolder = {
          id: Date.now(),
          title: targetName,
          content: [],
        };
        folders.push(newFolder);
        save();
        await renderGrid();
        openManager(newFolder.id);
        console.log(`[Patata] Nueva carpeta "${targetName}" creada y abierta.`);
      }
    }
  });

  init();
});

