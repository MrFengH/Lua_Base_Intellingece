# Guion de demo

Guion corto para presentar la aplicación ante el jurado. La app está en español; este documento
también. Para contexto técnico en inglés, ver [README.md](../README.md).

## A. Preparación antes de presentar

- [ ] Modelo 4B descargado y en caché local (ejecutar una vez antes, con red disponible):
  ```powershell
  $env:CIB_INFERENCE_MODE = 'qvac'
  $env:CIB_QVAC_MODEL = '4b'
  npm run dev
  ```
  Espere a que **Inicializar modelo local** complete y el badge muestre **Listo** al menos una vez.
  Después de esto, el modelo ya está en caché y no vuelve a descargarse.
- [ ] Fallback listo si el 4B es demasiado lento en la máquina de demo: `$env:CIB_QVAC_MODEL = '600m'`
      (ver [README.md#modelo-recomendado-para-la-demo](../README.md#modelo-recomendado-para-la-demo)).
- [ ] Base de datos en un estado apropiado para la demo (recién sembrada, o con el estado que
      quiera mostrar en Customer 360/Dashboard). `npm run seed` la reinicializa de forma idempotente.
- [ ] La app abierta y en la pantalla **Capturar**, con el badge de motor de inferencia visible.

## B. Flujo principal (3–5 minutos)

1. **Capturar una observación.** Use el botón "Usar observación de demostración", o escriba:
   `Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores y un tomógrafo.`
2. **Extracción QVAC local.** Señale el badge de motor: modelo, ejecución "En el dispositivo",
   "Red para inferencia: No" una vez cargado el modelo.
3. **Seguimientos (follow-ups).** Responda una o dos preguntas determinísticas (fabricante,
   antigüedad). Muestre que "no sé" registra un desconocido declarado y la pregunta no se repite.
4. **Revisión + confirmación.** Elija **Revisar información actual**, lea el resumen que el agente
   devuelve, y confirme con **Sí, es correcto**.
5. **Guardar.** Pulse **Guardar observación**.
6. **Customer 360.** La app cambia automáticamente a la ficha del cliente guardado.
7. **Evidencia, procedencia y confianza.** Abra **Detalles del campo** en una tarjeta de equipo:
   muestre el estado de conocimiento, la certeza, el origen y, si aplica, la marca "Corregido".
   Señale la tabla de observaciones de respaldo (texto original, append-only).
8. **Dashboard.** Muestre el resumen por modalidad y por país.

## C. Opcional, si queda tiempo

- **Revisión de duplicados/corroboración:** capture de nuevo el mismo hospital con una respuesta
  distinta de fabricante o antigüedad; Customer 360 mostrará candidatos pendientes. Abra
  **Revisar posibles coincidencias** y registre una decisión humana. Guion exacto con puntajes
  esperados: [docs/TESTING.md](TESTING.md#manual-walkthrough--duplicate-detection-a-corroboration-run-and-a-conflict-run)
  (script de QA en inglés, no pensado para leerse en vivo, pero reproducible).
- **Manejo de contradicciones:** durante una captura, diga primero "era NovaMed" y luego "en
  realidad no sé, quizás era Orion" — la app debe pedir cuál de las dos respuestas conservar en
  lugar de decidir por orden de mensaje.

## D. Mensajes clave para el jurado

- **Inferencia local.** Todo el texto de la observación se procesa en el dispositivo, vía
  `@qvac/sdk`. No hay proveedor de IA en la nube en ningún punto del flujo.
- **Evidencia de solo adición (append-only).** Nada se sobrescribe ni se borra; una corrección o
  una nueva visita agrega evidencia, nunca reemplaza la anterior.
- **Desconocido ≠ adivinado.** Cuando el observador no sabe algo, el campo queda explícitamente
  `Desconocido`, nunca se rellena con un valor plausible inventado.
- **La decisión final siempre es humana.** Duplicados y contradicciones se presentan para
  revisión; el sistema nunca fusiona ni resuelve automáticamente.
- **Datos sintéticos únicamente.** Todo el dataset (clientes, equipos, observaciones) es ficticio
  por construcción; no hay datos reales de pacientes, hospitales ni de Philips.

---

## Checklist de validación offline — **VALIDACIÓN HUMANA REQUERIDA**

Esta sección es un procedimiento para que una persona lo ejecute antes de afirmar que la app
funciona sin red. Ninguna de estas casillas ha sido marcada por un agente; nadie ha simulado un
corte físico de red en esta sesión. Ver también
[docs/PRIVACY_OFFLINE.md](PRIVACY_OFFLINE.md) para el modelo de amenazas completo.

- [ ] Modelo (4B o 600M, según cuál se use en la demo) descargado y confirmado en caché local.
- [ ] Cerrar la aplicación por completo.
- [ ] Desactivar Wi-Fi/Ethernet **físicamente** (no solo modo avión de software, si la máquina lo
      permite) o activar modo avión del sistema operativo.
- [ ] Reabrir la aplicación.
- [ ] Confirmar que el badge de motor llega a **Listo** (QVAC) sin ningún error de red.
- [ ] Ejecutar el flujo completo: capturar → seguimiento → revisión → guardar, sin errores.
- [ ] Abrir **Customer 360** y confirmar que la observación guardada aparece con su evidencia.
- [ ] Abrir **Dashboard** y confirmar que las cifras se actualizan.
- [ ] Reactivar la red al finalizar.

Hasta que una persona marque y confirme estas casillas, no debe afirmarse en público que la app
"se probó en modo avión" — solo que el diseño y el análisis estático (ver
[docs/PRIVACY_OFFLINE.md](PRIVACY_OFFLINE.md)) indican que debería funcionar así.
