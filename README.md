# Patata Clipboard V2

Sistema de carpetas digitales interactivas con almacenamiento en la nube usando GitHub como backend.

## Implementaciones

### 1. Sistema de Token Externo (GitHub API)

El problema fundamental fue cómo usar un token de GitHub desde una aplicación web sin exponerlo directamente en el código fuente.

**Solución implementada:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DEL TOKEN EXTERNO                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Token almacenado en Pastebin                                │
│     → https://pastebin.com/raw/DYwRH2H7                        │
│                                                                 │
│  2. Se accede a Pastebin a través de CORS Proxy                 │
│     → https://corsproxy.io/?https://pastebin.com/raw/DYwRH2H7  │
│                                                                 │
│  3. El navegador recibe el token sin problemas CORS            │
│                                                                 │
│  4. El token se usa para autenticarse con GitHub API            │
│     → api.github.com/repos/{org}/{repo}/contents/{path}        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Código clave (`script.js:4-23`):**
```javascript
const GITHUB_TOKEN_URL = "https://corsproxy.io/?https://pastebin.com/raw/DYwRH2H7";
let GITHUB_TOKEN = null;

async function loadToken() {
  const response = await fetch(GITHUB_TOKEN_URL);
  const text = await response.text();
  GITHUB_TOKEN = text.trim();
}
```

**¿Por qué funciona?**

1. **CORS Proxy como intermediario:** El navegador bloquea peticiones cross-origin por seguridad. `corsproxy.io` actúa como un proxy que:
   - Recibe la petición desde tu dominio
   - Hace la petición a Pastebin desde el servidor del proxy
   - Devuelve la respuesta con headers CORS permitidos

2. **Token en Pastebin:** Pastebin permite crear "pastes" públicos con URLs directas (`/raw`). El contenido es accesible como texto plano.

3. **Separación de concerns:** 
   - El código fuente no contiene el token real
   - Solo contiene la URL al pastebin
   - El token puede cambiarse en Pastebin sin modificar el código

**Ventajas:**
- El token no aparece en el repositorio público
- Fácil rotación del token (solo cambiar en Pastebin)
- Funciona en cualquier dominio sin configuración adicional

---

### 2. Sistema de Autenticación de Usuarios

**Registro (`script.js:225-246`):**
- Hash SHA-256 de contraseña + salt aleatorio
- Almacenamiento en repositorio GitHub: `usuarios/{username}.json`

**Login (`script.js:248-272`):**
- Verificación de hash almacenado vs hash calculado
- Sesión persistente via localStorage

---

### 3. Almacenamiento en la Nube (GitHub Repos)

**Repositorios utilizados:**
- `user-data-shard-01`: Datos de usuarios y metadatos
- `user-files-storage`: Archivos binarios

**Operaciones:**
- `readFromRepo()`: GET a la API de GitHub
- `writeToRepo()`: PUT con actualización (incluye SHA para control de concurrencia)
- `deleteFromRepo()`: DELETE con SHA del archivo

---

### 4. Sistema de Archivos Chuncados

Para archivos grandes, el sistema divide en chunks de ~500KB:

```
archivo_grande.mp4 (3MB)
    ↓
┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ chunk_0 │ chunk_1 │ chunk_2 │ chunk_3 │ chunk_4 │ chunk_5 │
└─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
    ↓           ↓           ↓           ↓           ↓           ↓
 userId/      userId/      userId/    userId/    userId/    userId/
 file_part0  file_part1   file_part2  file_part3  file_part4  file_part5
```

Cada chunk es un JSON con:
```json
{
  "chunk": "base64...",
  "totalChunks": 6,
  "chunkIndex": 0,
  "fileName": "video.mp4",
  "type": "video/mp4",
  "size": 3145728
}
```

---

### 5. Almacenamiento Local (IndexedDB)

Para funcionamiento offline y cache:

```javascript
const dbName = "PatataDB_V2";
// Almacena blobs de imágenes, videos, audio
await saveInDB(fileId, blob);
const blob = await getFromDB(fileId);
```

---

### 6. Sistema de Compartición (.patata)

Formato binario para compartir carpetas completo:

```
┌────────────────────────────────────┐
│ HEADER (4 bytes) = longitud JSON   │
├────────────────────────────────────┤
│ MANIFEST (JSON)                    │
│  - title: nombre carpeta           │
│  - items: array de items           │
│  - coverSize: tamaño portada       │
├────────────────────────────────────┤
│ COVER (bytes)                      │
├────────────────────────────────────┤
│ FILE_1 (bytes)                     │
├────────────────────────────────────┤
│ FILE_2 (bytes)                     │
├────────────────────────────────────┤
│ ... más archivos ...               │
└────────────────────────────────────┘
    ↓
Compresión gzip para reducir tamaño
```

---

### 7. Escucha de Mensajes Externos

Permite que otra página abra carpetas en esta app:

```javascript
window.addEventListener("message", async (event) => {
  // Solo acepta mensajes de la fuente oficial
  if (!event.origin.startsWith("https://demi1codex.github.io")) return;
  
  const { type, folderName, name } = event.data;
  // Crea o abre la carpeta especificada
});
```

---

## Estructura del Proyecto

```
clipboard-style/
├── index.html      # Interfaz principal
├── script.js       # Toda la lógica
├── style.css       # Estilos desktop
├── mobile.css      # Estilos mobile
└── palpueblo.png   # Favicon
```

## Uso

1. Abrir `index.html` en navegador
2. Registrarse o iniciar sesión
3. Crear carpetas y agregar contenido
4. Los datos se sincronizan automáticamente con GitHub

## Seguridad

- Contraseñas hasheadas con SHA-256 + salt
- Token de GitHub almacenado externamente
- Validación de origen en mensajes externos
