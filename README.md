# AuraDrive

Organizador local y offline de archivos inteligente con soporte para deshacer (undo) acciones, prevención de colisión de nombres y detección de archivos duplicados.

AuraDrive une los conceptos clave de organizadores de archivos modernos, permitiéndote limpiar carpetas desordenadas de forma segura directamente desde tu navegador mediante la API de acceso a archivos del sistema (File System Access API).

---

## ✨ Características

- 📁 **Organización Local y Privada**: Carga directorios locales arrastrando y soltando (drag-and-drop) o mediante selector. Tus datos no se suben a ningún servidor.
- 🔄 **Sistema de Deshacer (Undo)**: AuraDrive registra cada operación. Si te equivocas, puedes deshacer todo el proceso con un solo clic, devolviendo los archivos a sus nombres y rutas originales.
- ⚡ **Prevención de Conflictos**: Evita que se sobrescriban archivos con el mismo nombre y fecha sugeridos añadiendo sufijos numéricos automáticamente (ej. `_1.pdf`).
- 👥 **Detección de Duplicados**: Identifica duplicados por tamaño y nombre, agrupándolos para enviarlos a una papelera temporal (`_Trash/`) o eliminarlos de forma definitiva.
- 🏷️ **Reglas Personalizadas**: Configura plantillas de renombrado y rutas usando variables dinámicas como `{{year}}`, `{{month}}`, `{{vendor}}` y `{{amount}}`.
- ☁️ **Sincronización Cloud Directa**: Para organizar Google Drive o OneDrive sin configurar APIs, simplemente selecciona la carpeta local de sincronización en tu disco; el cliente de escritorio respectivo subirá los cambios ordenados automáticamente.

---

## 🚀 Cómo Empezar

1. Clona el repositorio:
   ```bash
   git clone https://github.com/PabloAballe/aura-drive.git
   ```
2. Ejecuta el servidor local:
   - En Windows, haz doble clic en `run.bat` o ejecuta `python -m http.server 8000`.
3. Abre en tu navegador Chrome, Edge u Opera la dirección:
   ```
   http://localhost:8000
   ```
4. Selecciona tu carpeta a organizar y previsualiza los cambios antes de ejecutar la limpieza.
