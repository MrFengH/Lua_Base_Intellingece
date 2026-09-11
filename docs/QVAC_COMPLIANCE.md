# Cumplimiento de QVAC

## Inventario de integración

| Requisito                   | Implementación                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK                         | `@qvac/sdk` 0.19.0, importado directamente solo bajo `src/infrastructure/qvac/`: `qvac-observation-extraction.ts` (texto) y `qvac-speech-to-text.ts` (voz)                                                                                                               |
| Módulos de runtime          | `@qvac/sdk/llamacpp-completion/plugin` (texto) y `@qvac/sdk/whispercpp-transcription/plugin` (voz), ambos habilitados en `qvac.config.json`                                                                                                                              |
| Lugar de ejecución          | En el dispositivo, en el worker de completado llama.cpp de QVAC (texto) y en el worker de transcripción whisper.cpp (voz)                                                                                                                                                |
| Modelo de texto por defecto | Descriptor del SDK `QWEN3_600M_INST_Q4` / `Qwen3-0.6B-Q4_0.gguf`                                                                                                                                                                                                         |
| Modelo de voz por defecto   | Descriptor del SDK `WHISPER_TINY_Q8_0` / `ggml-tiny-q8_0.bin`                                                                                                                                                                                                            |
| Modelo alternativo          | Archivo local suministrado mediante `CIB_QVAC_MODEL_PATH` (texto) o `CIB_QVAC_VOICE_MODEL_PATH` (voz)                                                                                                                                                                    |
| Salida estructurada         | Texto: `responseFormat: json_schema` de QVAC, generado desde Zod 4 con `z.toJSONSchema`, seguido de validación local con Zod. Voz: texto de transcripción plano colocado en el campo de texto existente para revisión humana — no se afirma salida estructurada para voz |
| Red durante la inferencia   | Ninguna requerida una vez que cada modelo está presente y cargado                                                                                                                                                                                                        |
| Uso de red inicial          | El registro del SDK puede descargar cualquiera de los dos modelos a su caché local en la primera inicialización de ese modelo                                                                                                                                            |
| IA en la nube               | Ninguna configurada ni invocada                                                                                                                                                                                                                                          |
| Respaldo (fallback)         | Ninguno en modo QVAC; los errores de inicialización/inferencia se muestran para ambas capacidades                                                                                                                                                                        |

## Ciclo de vida observable

La inicialización del modelo es explícita. El renderer muestra:

- motor (`QVAC` o `Development Mock`);
- ejecución (`On-device` o reglas locales deterministas);
- modelo seleccionado;
- si la inferencia necesita acceso a la red;
- estado model-not-loaded, downloading, loading, ready, processing, o error;
- detalle y progreso de descarga/carga cuando QVAC lo proporciona.

El adaptador real de texto realiza esta secuencia:

1. `heartbeat()` verifica e inicia el runtime local de QVAC.
2. `loadModel(...)` carga una ruta de modelo local o el descriptor oficial por defecto.
3. `getLoadedModelInfo(...)` verifica que exista el handler de completado.
4. `completion(...)` se ejecuta con los mensajes de sistema/usuario de la observación y un esquema JSON estricto.
5. `run.events` se drena; los tokens crudos generados no se registran en logs.
6. `run.final.contentText` se parsea y valida con `ObservationExtractionSchema`.
7. `unloadModel(...)` libera el modelo durante la liberación de recursos.

El adaptador real de voz (`QvacSpeechToTextService`) realiza la secuencia equivalente, de forma diferida en el
primer uso en lugar de en una acción explícita del usuario:

1. `heartbeat()` verifica e inicia el runtime local de QVAC (idempotente junto a la propia
   llamada del adaptador de texto — ver "Recomendación, aún no implementada" en docs/QVAC_ARCHITECTURE.md).
2. `loadModel(...)` carga una ruta de modelo de voz local o `WHISPER_TINY_Q8_0`, con
   `language: 'auto'` y `translate: false`.
3. `getLoadedModelInfo(...)` verifica que exista un handler de transcripción.
4. `transcribe({ modelId, audioChunk })` se ejecuta contra una ruta de archivo WAV local — nunca un
   búfer crudo en memoria enviado a ningún otro lugar, y nunca transmitido fuera del dispositivo.
5. El texto devuelto se recorta y se entrega; nada se drena/registra en logs más allá de los propios
   mensajes de transición de estado del adaptador (nunca la transcripción en sí).
6. `unloadModel(...)` libera el modelo durante la liberación de recursos de la aplicación.

El audio grabado en sí nunca llega a este adaptador como un artefacto persistido: `src/main/voice-transcription.ts` lo escribe en un archivo temporal del sistema operativo de un solo uso solo durante el paso 4 y
lo elimina en un bloque `finally` sin importar el resultado.

## Verificación

Ejecute:

```powershell
npm run qvac:smoke
```

Este script importa el adaptador de QVAC de producción —no el mock— y falla a menos que observe:

- inicialización del runtime de QVAC;
- carga del modelo;
- un completado local;
- salida estructurada válida que contenga al menos dos grupos de equipos.

Para un modelo local gestionado:

```powershell
$env:CIB_QVAC_MODEL_PATH = 'C:\models\model.gguf'
npm run qvac:smoke
```

Para voz, `npm run qvac:voice-smoke` ejecuta la prueba equivalente contra el adaptador real de whisper:
carga del modelo, una llamada de transcripción contra un archivo WAV sintetizado (sin habla real), y descarga. Esto
demuestra que el pipeline se ejecuta en esta máquina; no mide la precisión de la transcripción — ver
"Preguntas abiertas" de la Capacidad 2 en docs/MODEL_STRATEGY.md para saber por qué eso es un ejercicio
separado, aún no construido. Para un modelo de voz local gestionado:

```powershell
$env:CIB_QVAC_VOICE_MODEL_PATH = 'C:\models\ggml-tiny-q8_0.bin'
npm run qvac:voice-smoke
```

La suite estándar de unidad/integración usa intencionalmente el mock de desarrollo o dobles de prueba para que sea determinista. Un `npm test` en verde no se presenta como prueba de que alguno de los dos modelos de QVAC se haya cargado; los dos comandos smoke de arriba son la vía de prueba separada, y ninguno se ejecuta como parte de `npm test`.

## Frontera de privacidad

El texto de las observaciones cruza la frontera renderer/main solo mediante IPC explícito y se envía al adaptador de extracción local seleccionado. El audio de voz grabado cruza esa misma frontera como un búfer de bytes, se escribe en un archivo temporal local solo durante la duración de una llamada de transcripción, y se elimina inmediatamente después — nunca se envía a ningún otro lugar y nunca se persiste. El modo QVAC no tiene ningún endpoint de completado o transcripción en la nube. Los datos de SQLite permanecen en el dispositivo local. La aplicación no incluye telemetría, analítica, sincronización remota, ni navegación a URLs externas.

La descarga del registro de modelos por defecto es transporte para adquirir un artefacto de modelo, no inferencia remota. Los usuarios que requieran una configuración completamente desconectada pueden aprovisionar un archivo de modelo fuera de banda y seleccionarlo con `CIB_QVAC_MODEL_PATH` (texto) o `CIB_QVAC_VOICE_MODEL_PATH` (voz) antes de la inicialización.

## Limitación específica de esta versión

Esta implementación no afirma delegación de inferencia entre pares (peer-to-peer). El [lanzamiento del SDK de QVAC 0.19](https://github.com/tetherto/qvac/releases/tag/sdk-v0.19.0) eliminó la delegación de inferencia/modo de proveedor. Tanto el puerto de extracción como el puerto de voz a texto permanecen neutrales respecto a la implementación para futuras estrategias locales o distribuidas soportadas, pero sus implementaciones actuales de QVAC son estrictamente en el dispositivo.

Referencias: [SDK de QVAC para JavaScript/TypeScript](https://docs.qvac.tether.io/js-ts-sdk/), [tutorial de Electron](https://docs.qvac.tether.io/tutorials/electron/), y [requisitos de sistema](https://docs.qvac.tether.io/system-requirements/).
