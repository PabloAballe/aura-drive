# AuraDrive

> **Recupera la paz mental de un espacio de trabajo ordenado. Sin scripts complejos, sin dar acceso a tus nubes privadas y con red de seguridad total.**

Todos conocemos el estrés de ver una carpeta de descargas desbordada de archivos con nombres como `Factura_temp_2026_final.pdf`, fotos duplicadas en diferentes carpetas o código mezclado. Limpiarla da pereza, consume tiempo y, si lo haces rápido, da miedo cometer un error y borrar algo importante.

**AuraDrive** es una herramienta web minimalista que ordena el caos de tus carpetas locales en segundos, directamente desde tu navegador y de manera 100% privada.

---

## ✨ ¿Por qué AuraDrive?

* 🛡️ **Privacidad Absoluta (Offline)**: Tus archivos nunca salen de tu ordenador. Todo el análisis y la ordenación ocurren localmente en tu navegador mediante la API nativa de acceso a archivos.
* ↩️ **Botón de Deshacer (Undo)**: Trabaja sin miedo. Si aplicas la ordenación y no te convence el resultado, haz clic en **Deshacer** y todos tus archivos volverán exactamente a sus nombres y carpetas originales al instante.
* 🎯 **Prevención de Pérdida de Datos**: AuraDrive detecta si dos archivos diferentes terminarían con el mismo nombre sugerido (p. ej. dos facturas distintas del mismo día) y les añade sufijos automáticamente (`_1.pdf`) para evitar que se sobrescriban.
* 🗑️ **Limpieza Inteligente de Duplicados**: Agrupa archivos idénticos en tamaño y estructura, permitiéndote enviarlos a una papelera virtual (`_Trash/`) con opción a recuperarlos si cambias de opinión.
* ☁️ **Sincronización con tu Drive o OneDrive**: Olvídate de configurar complejas APIs. Simplemente selecciona tu carpeta de sincronización local (p. ej. `C:\Google Drive` o `C:\OneDrive`) y tu cliente de escritorio subirá los archivos ordenados automáticamente.

---

## 🛠️ Cómo Funciona (En 3 Pasos)

1. **Arrastra tu Carpeta**: Arrastra cualquier carpeta desordenada del explorador de archivos directamente a la pantalla de AuraDrive.
2. **Revisa la Propuesta**: Mira en tiempo real qué archivos se moverán, cuáles se renombrarán (p. ej. extrayendo automáticamente el proveedor y la fecha de tus facturas) y cuáles son duplicados marcados para limpieza.
3. **Organiza sin Esfuerzo**: Haz clic en **Organizar** para que AuraDrive cree la estructura de carpetas (ej. `Facturas/2026/Iberdrola/`) y mueva tus archivos automáticamente.

---

## 🚀 Cómo Empezar en 30 Segundos

AuraDrive no requiere base de datos ni instalación de dependencias pesadas:

1. **Descarga el código**:
   ```bash
   git clone https://github.com/PabloAballe/aura-drive.git
   ```
2. **Inicia la herramienta**:
   - En **Windows**: Haz doble clic en `run.bat`.
   - Alternativo (cualquier OS con Python): Ejecuta `python -m http.server 8000` en la carpeta.
3. **Abre el organizador**:
   Entra en tu navegador a:
   [http://localhost:8000](http://localhost:8000)

*Nota: Para disfrutar de la velocidad del escaneo de carpetas nativo de escritorio, se recomienda usar Google Chrome, Microsoft Edge u Opera.*
