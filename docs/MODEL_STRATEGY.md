# Estrategia de modelos

Qué modelos locales necesita esta aplicación, y por qué el más pequeño que funciona es el
correcto.

## Regla de selección

**Use el modelo local más pequeño que cumpla con el estándar de calidad declarado.** El tamaño del modelo cuesta tiempo
de descarga, disco, RAM, latencia, batería y peso del paquete en cada dispositivo en el campo. Un modelo
más grande solo se justifica después de que uno más pequeño haya sido medido y se haya demostrado que falla.

Una capacidad se agrega cuando el producto la necesita, no porque el SDK la soporte. QVAC 0.19.0
incluye plugins para embeddings, RAG, OCR, traducción, texto a voz, difusión, clasificación,
y visión. **Ninguno de ellos está habilitado**, y ninguno debería estarlo hasta que exista un requisito real.

Todas las constantes de modelo y tamaños de abajo están verificadas contra
`node_modules/@qvac/inference/dist/models/registry/models.js`. Vuelva a verificarlas ahí antes de
confiar en una cifra, y vuelva a verificarlas después de cualquier actualización del SDK.

## Capacidad 1 — Extracción de texto (implementada)

Observación en lenguaje natural convertida en un registro estructurado validado.

|                         |                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propósito**           | Convertir "vi dos resonadores NovaMed..." en grupos de equipos conformes al esquema                                                                                        |
| **Tipo de modelo**      | LLM ajustado a instrucciones con generación restringida por esquema JSON                                                                                                   |
| **Plugin de QVAC**      | `@qvac/sdk/llamacpp-completion/plugin`                                                                                                                                     |
| **Modelo seleccionado** | `QWEN3_600M_INST_Q4` (`Qwen3-0.6B-Q4_0.gguf`)                                                                                                                              |
| **Tamaño**              | 382,156,480 B ≈ 365 MiB                                                                                                                                                    |
| **Cuantización**        | Q4_0                                                                                                                                                                       |
| **Tamaño de contexto**  | 4096, establecido en el adaptador                                                                                                                                          |
| **Idiomas**             | Se requiere entrada en español e inglés; Qwen3 es multilingüe                                                                                                              |
| **Plataforma**          | Escritorio Windows vía Electron; driver Vulkan 1.4 según los requisitos de sistema de QVAC                                                                                 |
| **Estándar de calidad** | Los casos de extracción en [TESTING.md](TESTING.md) pasan, incluyendo la agrupación por antigüedad diferente y la preservación de la incertidumbre                         |
| **RAM esperada**        | **Por determinar** — ver [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md)                                                                                                  |
| **Respaldo (fallback)** | Ninguno en modo QVAC. Un fallo de carga o inferencia se muestra como un error. `CIB_QVAC_MODEL_PATH` permite un GGUF aprovisionado localmente, que no necesita ninguna red |
| **Ciclo de vida**       | Inicialización explícita, cargado una vez, reutilizado en cada extracción, descargado al liberar recursos de la aplicación                                                 |

### Por qué el modelo 0.6B

Es el modelo de completado más pequeño del registro contra el que se construyó la tarea, y la
tarea está fuertemente restringida: la salida está acotada por un esquema JSON, el vocabulario del dominio es pequeño
(seis modalidades), y cada resultado se vuelve a validar con Zod. La corrección estructural se impone
fuera del modelo, así que la capacidad del modelo se dedica a la comprensión, no al formato.

### Cuándo escalar

Escale a `QWEN3_1_7B_INST_Q4` (1,056,782,912 B ≈ 1008 MiB, aproximadamente 2.8× la descarga) **solo**
después de medir el modelo 0.6B contra el corpus de extracción completo y registrar qué casos falla.
Registre la medición en PERFORMANCE_BUDGETS.md y la decisión en DECISIONS.md.
Síntomas que lo justificarían: agrupación incorrecta sistemática de enunciados con múltiples dispositivos, o
colapsar antigüedades aproximadas en antigüedades exactas.

No escale porque la salida "se sienta" mejor en un solo ejemplo.

### Medición del 2026-09-10 (P4-S3) — estándar de calidad no cumplido, escalado no decidido aquí

`npm run corpus:eval` puntuó el modelo 0.6B contra `extraction-corpus-v1` (30 casos): **1 de 30
casos pasó y 43.8% de precisión de campo en general**. Las cifras completas, divididas por origen e idioma, están
en [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md); cada campo fallido, con su entrada, valor esperado
y valor real, está en `docs/qvac-eval-runs/2026-09-10T06-01-35-961Z.json`.

**El estándar de calidad declarado —que pasen los casos de TESTING.md— no se cumple.** Dos hallazgos de esta
ejecución, registrados en lugar de actuados:

- **`E-11`: la certeza nunca fue `Uncertain`.** A lo largo de los 30 casos el modelo nunca emitió
  `certainty: 'Uncertain'`, incluso en casos cuya entrada está explícitamente matizada ("around eleven years
  old", "maybe eight"). La rama de confianza `UNCERTAINTY_LANGUAGE` de `P3-S1` es real y alcanzable
  desde el mock, pero esta ejecución no da evidencia de que el modelo real la active alguna vez.
- 2 de 30 llamadas devolvieron JSON truncado e imposible de parsear ("Unterminated string in JSON"), ambas en
  entradas en español más largas con varios grupos de equipos — un posible límite de tamaño de contexto o
  de tokens máximos de salida, no investigado más a fondo aquí.

**El escalado no lo decide este documento.** Esta medición es el dato que pide la puerta de escalado de la
skill `qvac-model-selection`; si escalar a `QWEN3_1_7B_INST_Q4`, ajustar el prompt, o aceptar la línea base para
el demo es una decisión aparte que corresponde a una persona, y debe registrarse en `DECISIONS.md` si se toma. No se hizo
ningún cambio de modelo, cuantización o prompt para producir este número ni en respuesta a él.

### Intento inicial de escalado, 2026-09-10 — bloqueador histórico, resuelto posteriormente

`QvacObservationExtractionService` obtuvo un campo de configuración opcional `modelDescriptor` para que quien la invoque
pueda seleccionar `QWEN3_1_7B_INST_Q4` (un descriptor de registro real, exportado por `@qvac/sdk`, verificado contra
el SDK instalado, `expectedSize: 1,056,782,912`) en lugar del valor por defecto, mediante la misma sobrecarga
"cargar desde descriptor" de `loadModel` que ya usa el valor por defecto. `scripts/qvac-corpus-eval.ts`
expone esto como `CIB_QVAC_CORPUS_MODEL=1.7b`. No se introdujo ningún runtime, prompt ni contrato nuevo;
la inferencia sigue pasando exclusivamente por `@qvac/sdk`.

**Esta primera ejecución comparativa no se completó.** `CIB_QVAC_CORPUS_MODEL=1.7b npm run corpus:eval`
disparó la descarga del registro (el modelo aún no estaba en caché local), y esa descarga se estancó:
`~/.qvac/models/f7cce66406dee646_Qwen3-1.7B-Q4_0.gguf` se quedó en 0 bytes durante más de 15 minutos con los procesos
del worker de QVAC en CPU casi nula (0.05–0.85s de tiempo de CPU en total), a diferencia de la
descarga exitosa anterior del modelo 0.6B. El `src` de `QWEN3_1_7B_INST_Q4` se resuelve mediante el transporte de
registro entre pares del SDK basado en Hyperdrive/Corestore (`~/.qvac/registry-corestore/`); el estancamiento es coherente con que
ese transporte P2P no encontrara pares para este blob en el entorno de red actual, y no con un
defecto de código — el modelo 0.6B, obtenido mediante el mismo mecanismo de registro en otra ocasión,
se descargó sin problemas hasta sus 382,156,480 bytes completos. Los procesos estancados se terminaron
en lugar de dejarlos corriendo indefinidamente.

**No existió ninguna medición del 1.7B a partir de este intento.** Esto se conserva como procedencia histórica de
el fallo de adquisición. Se resolvió más tarde, como se registra en la sección de comparación rápida más abajo;
las opciones consideradas en su momento fueron:

1. Reintentar `CIB_QVAC_CORPUS_MODEL=1.7b npm run corpus:eval` en una máquina/red sin
   la restricción que parece estar bloqueando el transporte P2P del registro.
2. Obtener el archivo `Qwen3-1.7B-Q4_0.gguf` por otro canal y apuntar
   `CIB_QVAC_MODEL_PATH` (que el runner ya respeta y prioriza sobre
   `CIB_QVAC_CORPUS_MODEL`) al archivo local.
3. Aceptar la línea base medida del 0.6B para el demo dado el cronograma, y revisar el escalado más adelante.

### Comparación rápida resuelta el 2026-09-10 — el 4B mejora materialmente la calidad, sin cambio de producción

La adquisición del 1.7B previamente bloqueada se completó más tarde, y se evaluó un modelo adicional:
la exportación `QWEN3_4B_INST_Q4_K_M` del SDK instalado 0.19.0. Su descriptor de registro nombra
`Qwen3-4B-Q4_K_M.gguf`, Q4_K_M, 2,497,280,256 bytes, y usa el mismo motor
`llamacpp-completion` ya existente. No se probó ningún otro modelo.

| Candidato              | Precisión de campo del corpus | Aprobación total | Tamaño de registro | RAM pico | Resultado por idioma |  Latencia p50 / p95 / max |
| ---------------------- | ----------------------------: | ---------------: | -----------------: | -------- | -------------------- | ------------------------: |
| `QWEN3_600M_INST_Q4`   |                         49.8% |             0/30 |      382,156,480 B | TBD      | EN 53.9%; ES 39.0%   |  2,312 / 6,249 / 7,185 ms |
| `QWEN3_1_7B_INST_Q4`   |                         49.1% |             0/30 |    1,056,782,912 B | TBD      | EN 53.8%; ES 35.6%   |  2,241 / 2,819 / 3,238 ms |
| `QWEN3_4B_INST_Q4_K_M` |                     **63.4%** |         **3/30** |    2,497,280,256 B | TBD      | EN 62.4%; ES 66.2%   | 3,383 / 6,744 / 17,013 ms |

El criterio de aceptación sigue siendo que pasen los casos de extracción documentados, preservando a la vez
la incertidumbre y los valores desconocidos. Ninguno de los candidatos lo cumple. El resultado del 4B es, no obstante,
materialmente mejor que el del 1.7B (+14.2 puntos porcentuales en general y tres casos con aprobación total), así que la
instrucción condicional de cerrar la exploración no aplica. Esta comparación por sí sola **no**
justifica un cambio de producción: el modelo 4B sigue fallando en 27/30 casos, fabrica 42 valores,
nunca emite `Uncertain`, y tiene costos de carga y latencia materialmente más altos. El valor por defecto de producción por tanto
sigue siendo `QWEN3_600M_INST_Q4`; el respaldo y el ciclo de vida no cambian. Las métricas completas y las fallas
por caso están registradas en [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md) y en los tres
reportes JSON separados bajo `docs/qvac-eval-runs/`.

### 2026-09-10 — `QWEN3_4B_INST_Q4_K_M` aprobado para el demo; el valor por defecto de producción no cambia

Una ejecución posterior del corpus, `docs/qvac-eval-runs/4b-2026-09-10T18-16-39-837Z.json`, puntuó
`QWEN3_4B_INST_Q4_K_M` de nuevo sobre el mismo `extraction-corpus-v1` y midió **82.6% de precisión general
de campo (238/288 campos), 7/30 casos con aprobación total, EN 84.7% (182/215), ES 76.7% (56/73), adversarial
82.4% (61/74), y 11 valores fabricados** — materialmente más alto que tanto el 63.4% registrado para este
modelo en la comparación de arriba como el 43.8–49.8% registrado para `QWEN3_600M_INST_Q4` a lo largo de sus propias
ejecuciones. Una persona revisó este resultado y aprobó `QWEN3_4B_INST_Q4_K_M` como la configuración de modelo
recomendada y documentada para el demo próximo.

**Esta es una decisión de configuración para el demo, no un cambio del valor por defecto de producción.** El valor por defecto
global que se lee cuando `CIB_QVAC_MODEL` no está definido —usado por `npm run dev`, `npm test`, y el
valor por defecto del propio `npm run corpus:eval`— sigue siendo `QWEN3_600M_INST_Q4`, sin cambios. `CIB_QVAC_MODEL=4b`
hace que una ejecución use explícitamente el modelo del demo; `CIB_QVAC_MODEL=600m` selecciona el respaldo rápido documentado
de la misma manera. Ver la decisión 18 en [DECISIONS.md](DECISIONS.md) y el
[README](../README.md#modelo-recomendado-para-la-demo) para conocer el mecanismo. `QWEN3_4B_INST_Q4_K_M` aún
no cumple con el estándar de calidad declarado —23 de 30 casos fallan y `Uncertain` todavía nunca se emite—
así que esto sigue siendo una configuración de demo aprobada, no una afirmación de que el escalado esté completo o de que el
estándar de calidad de [TESTING.md](TESTING.md) se cumpla. No se hizo ningún cambio de prompt, esquema, o ajuste
de modelo para producir este número ni en respuesta a él.

## Capacidad 2 — Voz a texto (implementada, pulsar para hablar)

La voz es el modo natural de captura para alguien que camina por un pasillo de hospital. `SpeechToTextPort`
(`src/application/ports/platform.ts`) ahora tiene un adaptador real, `QvacSpeechToTextService`
(`src/infrastructure/qvac/qvac-speech-to-text.ts`), más un `DevelopmentMockSpeechToTextService`
que refleja la división mock/producción de la capacidad de extracción. `EvidenceSource` ya incluía
`Voice`; esta capacidad solo produce una transcripción para el campo de texto _existente_ — no
cambia qué se guarda ni cómo (ver "Qué no cambia esto" más abajo).

|                         |                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propósito**           | Audio a texto, colocado en el campo de texto existente para que el observador lo revise/edite — nunca se envía automáticamente, y alimenta el mismo pipeline de extracción sin cambios                                                                                       |
| **Tipo de modelo**      | ASR de la familia Whisper                                                                                                                                                                                                                                                    |
| **Plugin de QVAC**      | `@qvac/sdk/whispercpp-transcription/plugin`, habilitado en `qvac.config.json`                                                                                                                                                                                                |
| **Comando del SDK**     | `transcribe({ modelId, audioChunk, prompt?, metadata? })`, verificado en `node_modules/@qvac/inference/dist/api/transcribe.d.ts`                                                                                                                                             |
| **Modelo seleccionado** | `WHISPER_TINY_Q8_0` (`ggml-tiny-q8_0.bin`) — ver "Por qué `WHISPER_TINY_Q8_0`" más abajo                                                                                                                                                                                     |
| **Tamaño**              | 43,537,433 B ≈ 42 MiB                                                                                                                                                                                                                                                        |
| **Idiomas**             | `language: 'auto'`, `translate: false` — detecta automáticamente entre los dos idiomas de trabajo del observador (español, inglés) y nunca traduce, de modo que la transcripción se mantiene en las palabras realmente dichas                                                |
| **Respaldo (fallback)** | Captura de texto, que ya funciona y sigue siendo la vía principal; un fallo de transcripción muestra un error y deja el campo de texto exactamente como estaba                                                                                                               |
| **Ciclo de vida**       | Cargado de forma diferida en la primera llamada a `transcribe()` de una sesión (sin una acción separada de "inicializar voz" — pulsar para hablar es una sola acción del usuario, no dos), descargado al liberar recursos de la aplicación junto con el modelo de completado |

### Por qué `WHISPER_TINY_Q8_0`

El candidato **multilingüe** más pequeño de la tabla de abajo. No se seleccionó `WHISPER_SPANISH_TINY_Q8_0`:
el propio posicionamiento de este producto es la captura bilingüe ("se requiere entrada en español e inglés" —
ver la Capacidad 1 arriba), y un modelo solo en español fallaría silenciosamente o transcribiría mal
una observación en inglés. La detección automática multilingüe es el compromiso menor.

| Constante                   | Artefacto                     | Tamaño                  | Notas                                             |
| --------------------------- | ----------------------------- | ----------------------- | ------------------------------------------------- |
| `WHISPER_SPANISH_TINY_Q8_0` | `es-tiny-ggml-model-q8_0.bin` | 43,537,433 B ≈ 42 MiB   | Solo español; no seleccionado (producto bilingüe) |
| **`WHISPER_TINY_Q8_0`**     | `ggml-tiny-q8_0.bin`          | 43,537,433 B ≈ 42 MiB   | **Seleccionado** — tiny multilingüe               |
| `WHISPER_BASE_Q8_0`         | `ggml-base-q8_0.bin`          | 81,768,585 B ≈ 78 MiB   | Candidato de escalado, no medido                  |
| `WHISPER_SMALL_Q8_0`        | small q8_0                    | 264,464,607 B ≈ 252 MiB | Solo con evidencia medida                         |

Tanto `WHISPER_TINY_Q8_0` como `WHISPER_SPANISH_TINY_Q8_0` son de ≈42 MiB, un margen de error frente al
modelo de completado de 365 MiB — la diferencia de tamaño no impulsó esta elección; la cobertura
multilingüe sí.

### Qué no cambia esto

- El modelo de extracción, el prompt y el esquema (Capacidad 1) permanecen intactos — una transcripción es solo
  texto, indistinguible para el pipeline de extracción de cualquier cosa escrita.
- Nada se envía automáticamente. La transcripción llega al mismo `<textarea>` que el observador ya
  revisa y edita antes de pulsar Enviar.
- No se persiste audio crudo. `src/main/voice-transcription.ts` escribe los bytes grabados en un
  directorio temporal del sistema operativo de un solo uso solo durante la duración de la llamada a `transcribe()`, y siempre lo elimina
  después, con éxito o con fallo. La fila "Artefactos de audio" de `docs/PRIVACY_OFFLINE.md` sigue marcada como
  **PLANIFICADO** (no implementado) por esta razón — todavía no hay ningún `local_artifact_uri` que persistir.

### Preguntas abiertas — **por determinar**, no resueltas por esta implementación

- **RAM con dos modelos residentes.** Lo que dice "Runtime y worker" en `docs/QVAC_ARCHITECTURE.md`
  —"un modelo a la vez... un segundo modelo residente necesita una cifra de RAM medida"— no se satisface aquí: si la voz se usa en una sesión
  donde el modelo de completado ya está cargado, ambos permanecen residentes hasta la liberación de recursos. La carga diferida y la
  eventual liberación acotan esto, pero no existe ninguna medición. No agregue un segundo modelo siempre residente
  sin medir esto primero.
- **Estándar de calidad.** No existe ninguna medición de tasa de error de palabras contra vocabulario hospitalario
  (nombres de fabricantes, palabras de modalidad), y no se afirma ninguna. `npm run qvac:voice-smoke` (ver
  el README) demuestra que el pipeline se ejecuta de extremo a extremo en hardware real; no demuestra la precisión de
  la transcripción. Construya un pequeño conjunto de audio reservado antes de hacer cualquier afirmación sobre WER.
- **Espacio en disco.** ~42 MiB para el artefacto del modelo, almacenado en caché de la misma manera que el modelo de completado
  (ver "Política de ciclo de vida del modelo" más abajo); los archivos WAV temporales son transitorios (típicamente muy por debajo de 1 MiB
  para una observación dictada breve) y se eliminan inmediatamente después de cada transcripción.

## Capacidades deliberadamente no adoptadas

Cada una está disponible en QVAC y cada una es actualmente un **no**. Se registran para que la pregunta no
se reabra sin información nueva.

| Capacidad                          | Plugin               | Por qué no ahora                                                                                                                                                          | Qué lo cambiaría                                                                       |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Embeddings                         | `llamacpp-embedding` | La deduplicación es actualmente determinista y explicable. La similitud por embeddings la convertiría en una caja negra y seguiría necesitando un paso de revisión humana | Que el emparejamiento determinista falle demostrablemente sobre datos reales revisados |
| RAG                                | usa embeddings       | No hay ningún corpus del que recuperar. Toda la base de datos es pequeña y estructurada, y SQL responde las preguntas                                                     | Un corpus grande de documentos no estructurados, por ejemplo manuales de servicio      |
| OCR                                | `ggml-ocr`           | La evidencia `Photo` está tipada pero no implementada. Leer la etiqueta de un equipo es plausible pero nada captura fotos todavía                                         | Que la captura de fotos se lance, más un uso definido como leer placas de serie        |
| Visión multimodal                  | modelos de visión    | Igual que OCR, y mucho más pesado                                                                                                                                         | Una necesidad demostrada que OCR no pueda cubrir                                       |
| Traducción                         | `nmtcpp-translation` | El modelo de extracción es multilingüe. Traducir antes de la extracción agrega un paso y pierde las palabras exactas del hablante, que el esquema requiere                | Idiomas que el modelo de completado maneje mal                                         |
| Texto a voz                        | `tts-ggml`           | Nada en el flujo lee texto en voz alta                                                                                                                                    | Un requisito de accesibilidad o manos libres                                           |
| Difusión, generación de audio, VLA | varios               | Ningún uso concebible aquí                                                                                                                                                | —                                                                                      |

Agregar cualquier plugin a `qvac.config.json` agrega peso de runtime a cada build. La lista de plugins es
el presupuesto de bundle en [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md).

## Política de ciclo de vida del modelo

- **Adquisición.** Descarga del registro en la primera inicialización, o un archivo local preaprovisionado
  mediante `CIB_QVAC_MODEL_PATH`. El despliegue en campo debería preferir el aprovisionamiento; siga el
  [procedimiento de aprovisionamiento del README](../README.md#aprovisionar-un-modelo-en-otra-máquina). Ver
  [PRIVACY_OFFLINE.md](PRIVACY_OFFLINE.md) para la postura offline y su estado de validación.
- **Carga.** Explícita, iniciada por el usuario, con progreso visible.
- **Reutilización.** Una carga por sesión. Cargar por cada solicitud es un defecto.
- **Residencia.** Un modelo a la vez, por ahora. Dos modelos residentes necesitan una cifra de RAM pico medida
  antes de permitirse.
- **Descarga.** Al liberar recursos, conectada a la ruta de cierre de la aplicación.
- **Versionado.** Tanto el nombre del modelo como la versión del esquema se almacenan como contexto de cada
  observación guardada, de modo que un futuro cambio en el comportamiento de extracción sea rastreable.

## Antes de cambiar cualquiera de estas cosas

Use la skill `qvac-model-selection`. Requiere un estándar de calidad declarado, candidatos del
registro real, y mediciones antes de un escalado.
