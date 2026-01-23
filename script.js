/* Patata Clipboard V2 - Final Polish */

/* --- DATABASE --- */
const dbName = 'PatataDB_V2';
const storeName = 'mediaStore';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e);
    });
}
async function saveInDB(id, blob) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(blob, id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej();
    });
}
async function getFromDB(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej();
    });
}
async function delFromDB(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej();
    });
}

function getAudioCover(blob) {
    return new Promise((resolve) => {
        if (!window.jsmediatags) { resolve(null); return; }
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
                } else { resolve(null); }
            },
            onError: function (error) { resolve(null); }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentUser = localStorage.getItem('patataUser') || null;
    let folders = [];
    try {
        folders = JSON.parse(localStorage.getItem('patataFolders') || '[]');
    } catch (e) { folders = []; }
    let activeFolderId = null;

    // Elements
    const grid = document.getElementById('folderGrid');
    const addBtn = document.getElementById('addFolderBtn');
    const folderTemplate = document.getElementById('folderTemplate');
    const nameModal = document.getElementById('nameModal');
    const modal = document.getElementById('folderContentOverlay');
    const modalTitle = document.getElementById('currentFolderTitle');
    const contentArea = document.getElementById('contentArea');
    const closeBtn = document.getElementById('globalCloseBtn');

    // Tools
    const tools = {
        img: document.getElementById('uploadImage'),
        vid: document.getElementById('uploadVideo'),
        aud: document.getElementById('uploadAudio'),
        text: document.getElementById('addTextBtn'),
        txtFile: document.getElementById('uploadTxt'),
        cover: document.getElementById('setCover'),
        del: document.getElementById('deleteFolderBtn'),
        removeCover: document.getElementById('removeCoverBtn')
    };

    const init = async () => {
        if (!currentUser) {
            nameModal.classList.remove('hidden');
            document.getElementById('saveNameBtn').onclick = () => {
                const val = document.getElementById('userNameInput').value;
                if (val) {
                    currentUser = val;
                    localStorage.setItem('patataUser', val);
                    nameModal.classList.add('hidden');
                    document.getElementById('userDisplay').textContent = val;
                }
            };
        } else {
            document.getElementById('userDisplay').textContent = currentUser;
        }
        renderGrid();
    };

    const save = () => localStorage.setItem('patataFolders', JSON.stringify(folders));

    const renderGrid = async () => {
        const exist = grid.querySelectorAll('.folder-container');
        exist.forEach(e => e.remove());

        for (const f of folders) {
            const clone = folderTemplate.content.cloneNode(true);
            const el = clone.querySelector('.folder-container');
            const nameEl = clone.querySelector('.folder-name');
            const coverImg = clone.querySelector('.cover-image');
            const stack = clone.querySelector('.items-stack');

            el.dataset.id = f.id;
            nameEl.textContent = f.title;

            // Load Cover
            if (f.coverId) {
                try {
                    const blob = await getFromDB(f.coverId);
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        coverImg.style.backgroundImage = `url(${url})`;
                        coverImg.classList.remove('hidden');
                    }
                } catch (e) { }
            }

            // Stack Preview (Logic Improved for Visibility)
            if (f.content && f.content.length > 0) {
                const itemsToShow = f.content.slice(0, 3);
                for (let i = 0; i < itemsToShow.length; i++) {
                    const item = itemsToShow[i];
                    const paper = document.createElement('div');
                    paper.className = 'paper-preview';

                    if (item.type === 'text') {
                        paper.classList.add('text-paper');
                        paper.innerHTML = '<span style="font-size:1.2rem">📄</span>';
                    } else if (item.type === 'image' && item.fileId) {
                        getFromDB(item.fileId).then(blob => {
                            if (blob) {
                                paper.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
                                paper.classList.add('media-paper');
                            }
                        });
                    } else {
                        paper.innerHTML = item.type === 'video' ? '🎥' : '🎵';
                    }

                    // Improved Centering & Rotation
                    const rot = (Math.random() * 10 - 5);
                    paper.style.transform = `translateX(-50%) rotate(${rot}deg)`;
                    paper.style.left = '50%'; // Center
                    paper.style.bottom = `${i * 3}px`; // Slight vertical stack
                    paper.style.zIndex = i;

                    stack.appendChild(paper);
                }
            }

            nameEl.addEventListener('blur', () => { f.title = nameEl.textContent; save(); });
            nameEl.addEventListener('click', e => e.stopPropagation());

            grid.insertBefore(clone, addBtn);
        }
    };

    // Global Click Delegation (Robust)
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.folder-container');
        if (card && !e.target.classList.contains('folder-name')) {
            const id = parseInt(card.dataset.id);
            openManager(id);
        }
    });

    addBtn.addEventListener('click', () => {
        folders.push({ id: Date.now(), title: 'Nueva Carpeta', content: [] });
        save();
        renderGrid();
    });

    // --- Manager Logic ---
    const openManager = async (id) => {
        activeFolderId = id;
        const f = folders.find(x => x.id === id);
        if (!f) return;

        modalTitle.textContent = f.title;
        modal.classList.remove('hidden');

        if (f.coverId) tools.removeCover.classList.remove('hidden');
        else tools.removeCover.classList.add('hidden');

        renderContent(f);
    };

    const closeManager = () => {
        activeFolderId = null;
        modal.classList.add('hidden');
        renderGrid();
    };
    closeBtn.onclick = closeManager;

    const renderContent = async (f) => {
        contentArea.innerHTML = '';

        if (!f.content || f.content.length === 0) {
            contentArea.innerHTML = `<div style="width:100%; text-align:center; color:rgba(255,255,255,0.2); margin-top:50px;">
                <div style="font-size:3rem; margin-bottom:10px">📭</div>
                Carpeta vacía
            </div>`;
            return;
        }

        for (let i = 0; i < f.content.length; i++) {
            const item = f.content[i];
            const div = document.createElement('div');
            div.className = 'content-item';

            let html = `<span>${item.type}</span>`;

            if (item.type === 'text') {
                // Ensure text is readable
                html = `<p>${item.text}</p>`;
            } else if (item.fileId) {
                const blob = await getFromDB(item.fileId);
                if (blob) {
                    const url = URL.createObjectURL(blob);

                    if (item.type === 'image') {
                        html = `<img src="${url}">`;
                    } else if (item.type === 'video') {
                        html = `<video src="${url}" controls></video>`;
                    } else if (item.type === 'audio') {
                        html = `<div class="audio-wrapper">
                                    <div class="audio-art" id="art_${item.fileId}">🎵</div>
                                    <audio src="${url}" controls></audio>
                                </div>`;
                        getAudioCover(blob).then(artUrl => {
                            if (artUrl) {
                                const artEl = document.getElementById(`art_${item.fileId}`);
                                if (artEl) {
                                    artEl.style.backgroundImage = `url(${artUrl})`;
                                    artEl.textContent = '';
                                }
                            }
                        });
                    }
                }
            }

            div.innerHTML = html;

            const del = document.createElement('button');
            del.className = 'delete-btn-item';
            del.innerHTML = '&times;';
            del.onclick = async () => {
                if (item.fileId) await delFromDB(item.fileId);
                f.content.splice(i, 1);
                save();
                renderContent(f);
            };
            div.appendChild(del);

            contentArea.appendChild(div);
        }
    };

    // --- Tools ---

    tools.removeCover.onclick = async () => {
        const f = folders.find(x => x.id === activeFolderId);
        if (f && f.coverId) {
            await delFromDB(f.coverId);
            f.coverId = null;
            save();
            alert('Portada eliminada');
            tools.removeCover.classList.add('hidden');
        }
    }

    const handleFile = (input, type) => {
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file || !activeFolderId) return;
            const f = folders.find(x => x.id === activeFolderId);

            if (type === 'cover') {
                const coverId = `cov_${f.id}_${Date.now()}`;
                await saveInDB(coverId, file);
                if (f.coverId) await delFromDB(f.coverId);
                f.coverId = coverId;
                alert('Portada actualizada!');
                tools.removeCover.classList.remove('hidden');
            } else {
                const fileId = `file_${Date.now()}`;
                await saveInDB(fileId, file);
                f.content.push({ type, fileId, date: Date.now() });
            }
            save();
            renderContent(f);
            input.value = '';
        };
    };

    handleFile(tools.img, 'image');
    handleFile(tools.vid, 'video');
    handleFile(tools.aud, 'audio');
    handleFile(tools.cover, 'cover');

    tools.txtFile.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !activeFolderId) return;
        const text = await file.text();
        const f = folders.find(x => x.id === activeFolderId);
        f.content.push({ type: 'text', text: text, fromFile: file.name });
        save();
        renderContent(f);
        e.target.value = '';
    }

    tools.text.onclick = () => {
        const t = prompt('Escribe tu nota:');
        if (t && activeFolderId) {
            const f = folders.find(x => x.id === activeFolderId);
            f.content.push({ type: 'text', text: t });
            save();
            renderContent(f);
        }
    };

    tools.del.onclick = async () => {
        if (confirm('¿Borrar carpeta? (Irreversible)')) {
            const f = folders.find(x => x.id === activeFolderId);
            if (f.coverId) await delFromDB(f.coverId);
            for (const c of f.content) if (c.fileId) await delFromDB(c.fileId);

            folders = folders.filter(x => x.id !== activeFolderId);
            save();
            closeManager();
        }
    };

    init();
});
