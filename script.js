/* Patata Clipboard V2 - Final Polish */

/* --- GITHUB BACKEND INTEGRATION --- */
const GITHUB_TOKEN_URL = "https://corsproxy.io/?https://pastebin.com/raw/DYwRH2H7";
const ORG = "Demi1Codex";
const SINGLE_REPO = "user-data-shard-01";
const FILES_REPO = "user-files-storage";

let GITHUB_TOKEN = null;

async function loadToken() {
  try {
    console.log("[Token] Intentando cargar...");
    const response = await fetch(GITHUB_TOKEN_URL);
    console.log("[Token] Response status:", response.status);
    const text = await response.text();
    console.log("[Token] Raw text:", text);
    GITHUB_TOKEN = text.trim();
    console.log("[Token] Token cargado:", GITHUB_TOKEN ? GITHUB_TOKEN.substring(0, 10) + "..." : "VACÍO");
  } catch (e) {
    console.error("[Token] Error al cargar:", e);
  }
}

class GitHubCloud {
  constructor() {
    this.repo = SINGLE_REPO;
    this.filesRepo = FILES_REPO;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000;
  }

  base64Encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  base64Decode(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  // Convert blob to base64
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Convert base64 to blob
  base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  // Upload file as base64 in repo (chunked if needed)
  async uploadFileToRelease(userId, fileId, fileName, blob) {
    console.log("[Files] Starting upload:", fileName, "size:", blob.size);
    
    const base64 = await this.blobToBase64(blob);
    const chunks = [];
    const CHUNK_SIZE = 500000; // ~500KB per chunk to stay under 1MB limit
    
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      chunks.push(base64.slice(i, i + CHUNK_SIZE));
    }
    
    console.log("[Files] Splitting into", chunks.length, "chunks");
    
    // Upload each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = `${userId}/${fileId}_part${i}.json`;
      await this.writeToRepo(chunkPath, {
        chunk: chunks[i],
        totalChunks: chunks.length,
        chunkIndex: i,
        fileName: fileName,
        type: blob.type,
        size: blob.size
      }, `Upload part ${i + 1}/${chunks.length} of ${fileName}`);
    }
    
    // Return download info
    return {
      assetId: fileId,
      downloadUrl: `${userId}/${fileId}`,
      size: blob.size,
      name: fileName,
      type: blob.type,
      uploadedAt: new Date().toISOString(),
      totalChunks: chunks.length
    };
  }

  // Get file from repo (reassemble chunks)
  async getFileFromRelease(downloadUrl) {
    console.log("[Files] Downloading from:", downloadUrl);
    
    // Check if it's a legacy GitHub releases URL - these don't work anymore
    if (downloadUrl.includes('github.com') && downloadUrl.includes('releases')) {
      console.log("[Files] Legacy release URL - these files no longer exist in GitHub");
      throw new Error("Archivo antiguo - no disponible en la nube");
    }
    
    // New format: repo chunks
    console.log("[Files] Using repo chunk format");
    try {
      const parts = downloadUrl.split('/');
      const userId = parts[0];
      const fileId = parts[1];
      
      // Get first chunk to find total
      const firstChunk = await this.readFromRepo(`${userId}/${fileId}_part0.json`);
      const totalChunks = firstChunk.totalChunks;
      
      // Get all chunks in PARALLEL for faster download
      const chunkPromises = [];
      for (let i = 0; i < totalChunks; i++) {
        chunkPromises.push(this.readFromRepo(`${userId}/${fileId}_part${i}.json`));
      }
      
      console.log(`[Files] Downloading ${totalChunks} chunks in parallel...`);
      const allChunks = await Promise.all(chunkPromises);
      
      // Reassemble in order
      let fullBase64 = '';
      for (const chunk of allChunks) {
        fullBase64 += chunk.chunk;
      }
      
      console.log(`[Files] All chunks received, reconstructing file...`);
      return this.base64ToBlob(fullBase64, firstChunk.type);
    } catch (e) {
      console.error("[Files] Download failed:", e);
      throw e;
    }
  }

  // Delete file from repo (all chunks)
  async deleteFileFromRelease(assetId, userId) {
    console.log("[Files] Delete all chunks for:", assetId);
    // Read first chunk to get total
    try {
      const firstChunk = await this.readFromRepo(`${userId}/${assetId}_part0.json`);
      const totalChunks = firstChunk.totalChunks;
      for (let i = 0; i < totalChunks; i++) {
        await this.deleteFromRepo(`${userId}/${assetId}_part${i}.json`);
      }
    } catch (e) {
      console.log("[Files] Delete error:", e);
    }
  }

  async deleteFromRepo(path) {
    const CORS_PROXY = "https://corsproxy.io/?";
    try {
      const existing = await this.readFromRepo(path);
      const url = CORS_PROXY + encodeURIComponent(`https://api.github.com/repos/${ORG}/${this.repo}/contents/${path}`);
      await fetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": `token ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
          message: `Delete ${path}`,
          sha: existing._sha
        })
      });
    } catch (e) {}
  }

  async readFromRepo(path) {
    const CORS_PROXY = "https://corsproxy.io/?";
    const url = CORS_PROXY + encodeURIComponent(`https://api.github.com/repos/${ORG}/${this.repo}/contents/${path}`);
    console.log("[GitHub] Leyendo:", url);
    const response = await fetch(url, {
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json"
      }
    });

    console.log("[GitHub] Response status:", response.status);
    if (!response.ok) {
      if (response.status === 404) throw { status: 404 };
      console.error("[GitHub] Error reading:", response.status, response.statusText);
      throw new Error(`Error: ${response.status}`);
    }

    const data = await response.json();
    return { ...JSON.parse(this.base64Decode(data.content)), _sha: data.sha };
  }

  async writeToRepo(path, content, message) {
    const CORS_PROXY = "https://corsproxy.io/?";
    let sha = null;
    try {
      const existing = await this.readFromRepo(path);
      sha = existing._sha;
    } catch (e) { }

    const url = CORS_PROXY + encodeURIComponent(`https://api.github.com/repos/${ORG}/${this.repo}/contents/${path}`);
    const encodedContent = this.base64Encode(JSON.stringify(content, null, 2));

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message || `Update ${path}`,
        content: encodedContent,
        sha: sha
      })
    });

    if (!response.ok) {
      console.error("[GitHub] Error writing:", response.status, response.statusText);
      throw new Error(`Error writing: ${response.status}`);
    }
    return await response.json();
  }

  async registerUser(username, password) {
    const userPath = `usuarios/${username}.json`;
    
    try {
      await this.readFromRepo(userPath);
      throw new Error("El usuario ya existe");
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    
    const salt = Math.random().toString(36).substring(2);
    const passwordHash = await this.hashPassword(password, salt);
    
    const userData = {
      hash: passwordHash,
      salt: salt,
      createdAt: new Date().toISOString()
    };
    
    await this.writeToRepo(userPath, userData, `Register user ${username}`);
    return true;
  }

  async loginUser(username, password) {
    const userPath = `usuarios/${username}.json`;
    console.log("[GitHub] Intentando login:", userPath);
    
    try {
      const userData = await this.readFromRepo(userPath);
      console.log("[GitHub] Usuario encontrado, verificando contraseña...");
      
      const isValid = await this.verifyPassword(password, userData.salt, userData.hash);
      console.log("[GitHub] Contraseña válida:", isValid);
      
      if (!isValid) {
        throw new Error("Contraseña incorrecta");
      }
      
      console.log("[GitHub] Login exitoso");
      return true;
    } catch (e) {
      console.error("[GitHub] Error en login:", e);
      if (e.status === 404) {
        throw new Error("Usuario no encontrado");
      }
      throw e;
    }
  }

  hashPassword(password, salt) {
    const combined = password + salt;
    console.log("[Hash] Input:", combined);
    
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined))
      .then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        console.log("[Hash] Output:", hashHex);
        return hashHex + salt;
      });
  }

  async verifyPassword(password, salt, expectedHash) {
    const computedHash = await this.hashPassword(password, salt);
    console.log("[Verify] Computed (with salt):", computedHash);
    console.log("[Verify] Expected (with salt):", expectedHash);
    return computedHash === expectedHash;
  }

  async getUserData(userId) {
    if (this.cache.has(userId)) {
      const cached = this.cache.get(userId);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    try {
      const data = await this.readFromRepo(`usuarios/${userId}.json`);
      this.cache.set(userId, { data, timestamp: Date.now() });
      return data;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async saveUserData(userId, data) {
    // Get existing user data to preserve auth fields
    let existingData = null;
    try {
      existingData = await this.readFromRepo(`usuarios/${userId}.json`);
    } catch (e) {}
    
    const enrichedData = {
      hash: existingData?.hash || data.hash,
      salt: existingData?.salt || data.salt,
      createdAt: existingData?.createdAt || data.createdAt,
      folders: data.folders,
      syncedAt: new Date().toISOString()
    };

    await this.writeToRepo(`usuarios/${userId}.json`, enrichedData, `Save user data ${userId}`);
    this.cache.set(userId, { data: enrichedData, timestamp: Date.now() });
    return enrichedData;
  }

  async syncToCloud(userId, folders) {
    // Get existing user data to preserve auth fields
    let existingData = null;
    try {
      existingData = await this.readFromRepo(`usuarios/${userId}.json`);
    } catch (e) {}
    
    const data = { 
      folders: folders, 
      syncedAt: new Date().toISOString(),
      hash: existingData?.hash,
      salt: existingData?.salt,
      createdAt: existingData?.createdAt
    };
    return await this.saveUserData(userId, data);
  }

  async loadFromCloud(userId) {
    const data = await this.getUserData(userId);
    return data?.folders || null;
  }
}

const githubCloud = new GitHubCloud();

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
    // Load token first
    await loadToken();
    
    if (!GITHUB_TOKEN) {
      alert("Error: No se pudo cargar el token de GitHub");
      return;
    }
    
    // Auto-load from cloud function
    const loadFromCloudAuto = async () => {
      const cloudStatus = document.getElementById("cloudStatus");
      try {
        cloudStatus.textContent = "☁️ Sincronizando...";
        const cloudFolders = await githubCloud.loadFromCloud(currentUser);
        if (cloudFolders && cloudFolders.length > 0) {
          folders = cloudFolders;
          localStorage.setItem("patataFolders", JSON.stringify(folders));
          renderGrid();
          cloudStatus.textContent = "☁️ Sincronizado";
        } else {
          cloudStatus.textContent = "☁️ Listo";
        }
        setTimeout(() => cloudStatus.textContent = "", 3000);
      } catch (e) {
        cloudStatus.textContent = "☁️ Local";
        console.log("[Cloud] No hay datos en la nube, usando modo local");
      }
    };

    if (!currentUser) {
      nameModal.classList.remove("hidden");
      
      // Tab switching
      const loginTab = document.getElementById("loginTab");
      const registerTab = document.getElementById("registerTab");
      
      loginTab.addEventListener("click", () => {
        loginTab.classList.add("active");
        registerTab.classList.remove("active");
        document.getElementById("loginForm").classList.remove("hidden");
        document.getElementById("registerForm").classList.add("hidden");
      });
      
      registerTab.addEventListener("click", () => {
        registerTab.classList.add("active");
        loginTab.classList.remove("active");
        document.getElementById("registerForm").classList.remove("hidden");
        document.getElementById("loginForm").classList.add("hidden");
      });
      
      // Login button
      document.getElementById("loginBtn").addEventListener("click", async () => {
        console.log("[Login] Botón presionado");
        const username = document.getElementById("userNameInput").value.trim();
        const password = document.getElementById("userPasswordInput").value;
        
        if (!username || !password) {
          alert("Por favor completa todos los campos");
          return;
        }
        
        console.log("[Login] Intentando login para:", username);
        try {
          await githubCloud.loginUser(username, password);
          currentUser = username;
          localStorage.setItem("patataUser", username);
          nameModal.classList.add("hidden");
          document.getElementById("userDisplay").textContent = username;
          loadFromCloudAuto();
        } catch (e) {
          console.error("[Login] Error:", e);
          alert(e.message || "Error al iniciar sesión");
        }
      });
      
      // Login on Enter key
      document.getElementById("userPasswordInput").addEventListener("keypress", async (e) => {
        if (e.key === "Enter") {
          document.getElementById("loginBtn").click();
        }
      });
      
      // Register button
      document.getElementById("registerBtn").addEventListener("click", async () => {
        const username = document.getElementById("newUserName").value.trim();
        const password = document.getElementById("newUserPassword").value;
        const confirmPassword = document.getElementById("newUserPasswordConfirm").value;
        
        if (!username || !password) {
          alert("Por favor completa todos los campos");
          return;
        }
        
        if (password !== confirmPassword) {
          alert("Las contraseñas no coinciden");
          return;
        }
        
        if (password.length < 4) {
          alert("La contraseña debe tener al menos 4 caracteres");
          return;
        }
        
        try {
          await githubCloud.registerUser(username, password);
          alert("¡Cuenta creada! Ahora puedes iniciar sesión");
          document.getElementById("loginTab").click();
        } catch (e) {
          alert(e.message || "Error al crear cuenta");
        }
      });
    } else {
      document.getElementById("userDisplay").textContent = currentUser;
      loadFromCloudAuto();
    }

    // Cloud Buttons (manual sync)
    const cloudSyncBtn = document.getElementById("cloudSyncBtn");
    const cloudLoadBtn = document.getElementById("cloudLoadBtn");
    const cloudStatus = document.getElementById("cloudStatus");

    cloudSyncBtn.addEventListener("click", async () => {
      if (!currentUser) {
        alert("Por favor ingresa tu nombre primero");
        return;
      }
      try {
        cloudStatus.textContent = "☁️ Guardando...";
        await githubCloud.syncToCloud(currentUser, folders);
        cloudStatus.textContent = "☁️ Guardado";
        setTimeout(() => cloudStatus.textContent = "", 2000);
      } catch (e) {
        cloudStatus.textContent = "☁️ Error";
        console.error(e);
      }
    });

    cloudLoadBtn.addEventListener("click", async () => {
      if (!currentUser) {
        alert("Por favor ingresa tu nombre primero");
        return;
      }
      if (!confirm("Esto sobrescribirá tus carpetas locales con las de la nube. ¿Continuar?")) {
        return;
      }
      await loadFromCloudAuto();
    });

    // Clean sync button - wipe local data and reload from cloud
    document.getElementById("cleanSyncBtn").addEventListener("click", async () => {
      if (!currentUser) {
        alert("Por favor ingresa tu nombre primero");
        return;
      }
      if (!confirm("⚠️ Esto borrará TODOS los datos locales (archivos, portadas) y descargará todo de nuevo desde la nube. ¿Continuar?")) {
        return;
      }
      
      const cloudStatus = document.getElementById("cloudStatus");
      try {
        cloudStatus.textContent = "🧹 Limpiando...";
        
        // Delete all IndexedDB data
        await new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(dbName);
          req.onsuccess = () => {
            console.log("[Clean] IndexedDB deleted");
            resolve();
          };
          req.onerror = () => {
            console.log("[Clean] Error deleting DB");
            resolve();
          };
        });
        
        // Clear local folders
        folders = [];
        localStorage.setItem("patataFolders", JSON.stringify(folders));
        
        // Reload from cloud
        cloudStatus.textContent = "☁️ Descargando...";
        await loadFromCloudAuto();
        
        cloudStatus.textContent = "✅ Limpio y sincronizado";
      } catch (e) {
        console.error("[Clean] Error:", e);
        cloudStatus.textContent = "❌ Error al limpiar";
        alert("Error: " + e.message);
      }
    });

    // Logout button
    document.getElementById("logoutBtn").addEventListener("click", () => {
      if (confirm("¿Cerrar sesión? Los datos locales se mantendrán.")) {
        currentUser = null;
        localStorage.removeItem("patataUser");
        localStorage.removeItem("patataPassword");
        folders = [];
        localStorage.setItem("patataFolders", JSON.stringify(folders));
        renderGrid();
        document.getElementById("userDisplay").textContent = "...";
        nameModal.classList.remove("hidden");
        document.getElementById("loginForm").classList.remove("hidden");
        document.getElementById("registerForm").classList.add("hidden");
        document.getElementById("userNameInput").value = "";
        document.getElementById("userPasswordInput").value = "";
        document.getElementById("cloudStatus").textContent = "☁️ Desconectado";
      }
    });

    // --- Auto-create folder from URL "folderName" parameter ---
    const urlParams = new URLSearchParams(window.location.search);
    const rawFolderName = urlParams.get('folderName');

    if (rawFolderName) {
      const folderTitle = decodeURIComponent(rawFolderName);
      let targetFolder = folders.find(f => f.title.toLowerCase() === folderTitle.toLowerCase());

      if (!targetFolder) {
        targetFolder = {
          id: Date.now(),
          title: folderTitle,
          content: []
        };
        folders.push(targetFolder);
        save();
        console.log(`[Patata] Carpeta creada desde URL: ${folderTitle}`);
      }

      setTimeout(() => openManager(targetFolder.id), 100);
    }

    renderGrid();
  };

  const save = () => {
    localStorage.setItem("patataFolders", JSON.stringify(folders));
    // Auto-sync to cloud (non-blocking)
    if (currentUser) {
      githubCloud.syncToCloud(currentUser, folders).then(() => {
        const status = document.getElementById("cloudStatus");
        if (status) {
          status.textContent = "☁️ Guardado";
          setTimeout(() => status.textContent = "", 2000);
        }
      }).catch(e => console.log("[Cloud] Auto-save:", e.message));
    }
  };

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

      // Load Cover (local only)
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

    // Helper to get blob - tries cloud first, then local
    const getBlob = async (item) => {
      // Try cloud if downloadUrl exists (new format without github.com)
      if (item.downloadUrl && !item.downloadUrl.includes('github.com')) {
        try {
          console.log("[Render] Downloading from cloud:", item.downloadUrl);
          const blob = await githubCloud.getFileFromRelease(item.downloadUrl);
          if (blob && item.fileId) {
            await saveInDB(item.fileId, blob); // Cache locally
          }
          return blob;
        } catch (e) {
          console.log("[Render] Cloud failed, trying local:", e.message);
        }
      }
      // Fallback to local
      if (item.fileId) {
        return await getFromDB(item.fileId);
      }
      return null;
    };

    for (let i = 0; i < f.content.length; i++) {
      const item = f.content[i];
      const div = document.createElement("div");
      div.className = "content-item";
      const uniqueId = item.fileId || item.date;
      div.dataset.id = uniqueId;

      let html = `<span>${item.type}</span>`;

      if (item.type === "text") {
        html = `<p>${item.text}</p>`;
      } else if (item.type === "file") {
        html = `<div class="audio-wrapper"><div class="audio-art">📎</div><p style="text-align:center; word-break:break-all;">${item.name || "Archivo"
          }</p></div>`;
      } else if (item.fileId) {
        try {
          const blob = await getBlob(item);
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
        } catch (e) {
          console.log("[Render] Error loading file:", e);
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
      
      const cloudStatus = document.getElementById("cloudStatus");
      cloudStatus.textContent = "☁️ Subiendo a GitHub...";

      try {
        if (type === "cover") {
          const coverId = `cov_${f.id}_${Date.now()}`;
          
          // Save locally first
          await saveInDB(coverId, file);
          
          // Upload to GitHub chunks
          const fileInfo = await githubCloud.uploadFileToRelease(currentUser, coverId, file.name, file);
          
          f.coverId = coverId;
          f.coverFile = {
            assetId: fileInfo.assetId,
            downloadUrl: fileInfo.downloadUrl,
            name: file.name,
            type: file.type,
            size: file.size
          };
          
          alert("Portada guardada!");
          tools.removeCover.classList.remove("hidden");
        } else {
          const fileId = `file_${Date.now()}`;
          
          // Save locally first
          await saveInDB(fileId, file);
          
          // Upload to GitHub chunks
          const fileInfo = await githubCloud.uploadFileToRelease(currentUser, fileId, file.name, file);
          
          f.content.push({
            type,
            fileId,
            name: file.name,
            date: Date.now(),
            downloadUrl: fileInfo.downloadUrl,
            size: file.size,
            fileType: file.type
          });
          
          cloudStatus.textContent = "☁️ Subido a GitHub";
        }
      } catch (error) {
        console.error("Error uploading:", error);
        
        // Fallback to local only
        if (type === "cover") {
          const coverId = `cov_${f.id}_${Date.now()}`;
          await saveInDB(coverId, file);
          if (f.coverId) await delFromDB(f.coverId);
          f.coverId = coverId;
          alert("Portada guardada localmente");
          tools.removeCover.classList.remove("hidden");
        } else {
          const fileId = `file_${Date.now()}`;
          await saveInDB(fileId, file);
          f.content.push({
            type,
            fileId,
            name: file.name,
            date: Date.now(),
            size: file.size,
            fileType: file.type
          });
          cloudStatus.textContent = "💾 Guardado localmente";
        }
      }
      
      save();
      renderContent(f);
      input.value = "";
      setTimeout(() => cloudStatus.textContent = "", 3000);
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
        let blob = null;
        
        // Try cloud first (for files uploaded to cloud)
        if (item.downloadUrl && !item.downloadUrl.includes('github.com')) {
          try {
            console.log("[Download] Trying cloud:", item.downloadUrl);
            blob = await githubCloud.getFileFromRelease(item.downloadUrl);
            if (blob) await saveInDB(item.fileId, blob);
          } catch (e) {
            console.log("[Download] Cloud failed:", e);
          }
        }
        
        // Fallback to local
        if (!blob) {
          blob = await getFromDB(item.fileId);
        }
        
        if (blob) {
          // Mobile-friendly download
          const fileName = item.name || "download";
          const url = URL.createObjectURL(blob);
          
          // For mobile, try using the download attribute first
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          a.style.display = "none";
          document.body.appendChild(a);
          
          // Try click download
          a.click();
          
          // For mobile browsers that don't support download attribute,
          // also try opening in new tab
          setTimeout(() => {
            try {
              const openA = document.createElement("a");
              openA.href = url;
              openA.target = "_blank";
              openA.rel = "noopener";
              document.body.appendChild(openA);
              openA.click();
              setTimeout(() => {
                document.body.removeChild(openA);
              }, 100);
            } catch(e) {}
          }, 500);
          
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 1000);
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

