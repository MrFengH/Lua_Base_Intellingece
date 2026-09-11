# Presupuestos de rendimiento

## Estado: no se ha especificado hardware objetivo

Cada objetivo numérico en este documento es **por determinar**. El hardware de despliegue para los
colegas de campo se desconoce, así que inventar umbrales convertiría una suposición en un requisito contra el que
se mediría trabajo futuro. Lo que se define aquí en su lugar es: qué medir, cómo
medirlo, y la forma de los perfiles a completar una vez que se conozca el hardware.

La única cifra que es real es el tamaño de descarga del modelo, porque proviene del registro de QVAC.

## Métricas a medir

| Métrica                                     | Unidad                  | Por qué importa                                                            | Objetivo       |
| ------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- | -------------- |
| Tiempo de descarga del modelo, en frío      | s                       | Experiencia de primera ejecución, y si el aprovisionamiento es obligatorio | Por determinar |
| Tiempo de carga del modelo                  | ms                      | Cuánto espera el usuario tras pedir inicializar                            | Por determinar |
| Latencia del primer token                   | ms                      | Capacidad de respuesta percibida                                           | Por determinar |
| Latencia total de extracción                | ms                      | El número que el usuario realmente siente, por turno de captura            | Por determinar |
| Latencia de transcripción (**PLANIFICADO**) | ms por segundo de audio | Si la captura de voz se siente en vivo                                     | Por determinar |
| Tokens por segundo                          | tok/s                   | Comparar modelos y cuantizaciones                                          | Por determinar |
| RSS pico durante la inferencia              | MB                      | Si la app sobrevive en una máquina de gama baja                            | Por determinar |
| RSS en reposo, modelo cargado               | MB                      | Costo de mantener un modelo residente                                      | Por determinar |
| RSS en reposo, modelo descargado            | MB                      | Prueba que la descarga realmente libera memoria                            | Por determinar |
| Utilización de CPU durante la inferencia    | %                       | Comportamiento térmico y de batería                                        | Por determinar |
| Utilización de GPU durante la inferencia    | %                       | Si la aceleración Vulkan está siquiera activa                              | Por determinar |
| Tamaño del paquete de la aplicación         | MB                      | Costo de distribución, determinado por la lista de plugins de QVAC         | Por determinar |
| Almacenamiento del modelo en disco          | MB                      | Aprovisionamiento del dispositivo                                          | 365 MiB hoy    |
| Consumo de batería por captura              | %/hora o mWh            | Si un día completo de visitas es viable                                    | Por determinar |
| Tasa de éxito de salida estructurada        | %                       | Proporción de extracciones que pasan Zod en el primer intento              | Por determinar |
| Precisión de extracción                     | % de casos del corpus   | Corrección, no velocidad. Ver [TESTING.md](TESTING.md)                     | Por determinar |

La tasa de éxito de salida estructurada merece énfasis: una extracción rápida que falla la validación no
vale nada, y un cambio de modelo que mejora la latencia mientras baja este número es una
regresión.

## Costos fijos conocidos

| Elemento                         | Valor                   | Fuente                                               |
| -------------------------------- | ----------------------- | ---------------------------------------------------- |
| Modelo de completado por defecto | 382,156,480 B ≈ 365 MiB | entrada de registro `QWEN3_600M_INST_Q4`             |
| Tamaño de contexto               | 4096 tokens             | establecido en el adaptador de QVAC                  |
| Plugins de QVAC habilitados      | 1 de 12 disponibles     | `qvac.config.json`                                   |
| Whisper tiny, si la voz se lanza | ≈ 42 MiB                | registro, ver [MODEL_STRATEGY.md](MODEL_STRATEGY.md) |

El número de plugins es la palanca del bundle. Cada plugin agregado a `qvac.config.json` agrega peso de
runtime a cada build, así que los plugins se habilitan solo cuando una función lanzada los usa.

## Metodología

Siga esto exactamente, o los números no serán comparables.

### 1. Registre el entorno

SO y build, modelo de CPU, RAM física, GPU y versión del driver, si Vulkan 1.4 está disponible,
versión de Node, alimentación de red eléctrica o batería. Una medición sin este encabezado es inutilizable.

### 2. Fije el escenario

Mismo texto de entrada, mismo modelo, misma cuantización, mismo tamaño de contexto, misma configuración. Escriba la
entrada en el reporte. La frase de demo del README es un valor por defecto razonable; un enunciado en español
con varios dispositivos es un mejor caso de estrés.

### 3. Separe la carga de la inferencia

El tiempo de carga del modelo y la latencia de inferencia son presupuestos diferentes con soluciones diferentes. Nunca reporte
un número que incluya ambos.

### 4. Caliente, luego repita

Descarte la primera inferencia. Ejecute al menos cinco más. Reporte mediana, mínimo y máximo. Una sola
muestra no es una medición.

### 5. Mida la memoria en tres puntos

En reposo antes de la carga, en reposo después de la carga, pico durante la inferencia. La diferencia entre el primero y el tercer
punto es el costo real de la funcionalidad; la diferencia entre el primero y la cifra posterior a la descarga prueba
que la descarga realmente funciona.

### 6. Compare

Contra la línea base registrada previamente, y contra el objetivo en este archivo. Cuando el objetivo sea "por determinar",
diga "por determinar". No invente un umbral para poder declarar una aprobación.

### 7. Registre

Agregue líneas base que valga la pena conservar a la sección de resultados de abajo, con el encabezado de entorno.

## Perfiles a definir una vez que se conozca el hardware

Marcadores de posición. Complételos cuando se especifique la flota de despliegue.

### Gama baja

La máquina mínima en la que la aplicación debe seguir siendo usable. Probablemente gráficos integrados, RAM
modesta. Determina si el modelo 0.6B es el techo y si un modelo puede permanecer residente.

| Métrica                              | Objetivo       |
| ------------------------------------ | -------------- |
| Tiempo de carga del modelo           | por determinar |
| Latencia total de extracción         | por determinar |
| RSS pico                             | por determinar |
| Tasa de éxito de salida estructurada | por determinar |

### Recomendada

La máquina para la que está diseñada la experiencia.

| Métrica                              | Objetivo       |
| ------------------------------------ | -------------- |
| Tiempo de carga del modelo           | por determinar |
| Latencia total de extracción         | por determinar |
| RSS pico                             | por determinar |
| Tasa de éxito de salida estructurada | por determinar |

### Gama alta

Donde se podría ofrecer un modelo más grande como opción. Note que una elección de modelo por perfil implica
dos comportamientos de extracción en el campo, lo cual tiene consecuencias para comparar registros guardados.
Ese compromiso está sin resolver — **por determinar**.

| Métrica                                     | Objetivo       |
| ------------------------------------------- | -------------- |
| Latencia total de extracción                | por determinar |
| RSS pico                                    | por determinar |
| Escalado a un modelo más grande justificado | por determinar |

## Soporte útil del SDK

`@qvac/sdk` 0.19.0 exporta `getSystemResources()` y `assessModelFit()`, más un `profiler`.
Ninguno se usa todavía. Son la base obvia para una verificación de capacidad del dispositivo que elija un
perfil en tiempo de ejecución — **PROPUESTO**, no implementado, y que no debería construirse antes de que existan
objetivos reales contra los cuales verificar.

## Resultados registrados

### 2026-09-10 — comparación rápida de modelos, `extraction-corpus-v1` fijo

Se usaron los mismos 30 casos, prompt, esquema, evaluador, configuración de muestreo, tamaño de contexto, y la ruta de
extracción de producción para los tres reportes. Ningún resultado fue seguido de una optimización de prompt o de
inferencia. Los fallos detallados permanecen en los reportes JSON separados:

- `docs/qvac-eval-runs/600m-2026-09-10T12-59-49-257Z.json`
- `docs/qvac-eval-runs/1.7b-2026-09-10T17-14-15-271Z.json`
- `docs/qvac-eval-runs/4b-2026-09-10T17-28-37-527Z.json`

El descriptor 4B se verificó contra la exportación y el registro de `@qvac/sdk` 0.19.0 instalado como
`QWEN3_4B_INST_Q4_K_M` (`Qwen3-4B-Q4_K_M.gguf`, 2,497,280,256 bytes, Q4_K_M,
`llamacpp-completion`). La ejecución del 4B usó la misma máquina que las ejecuciones anteriores, pero el comando
resolvió el Node 24.19.0 del sistema en lugar del Node 24.20.0 empaquetado registrado para las ejecuciones anteriores;
esta diferencia de runtime es una limitación para la comparación de latencia. El estado de alimentación, la CPU, la RAM, la GPU,
el driver, y el RSS pico del worker no fueron medibles desde el sandbox y permanecen sin confirmar/por determinar.

| Métrica                         |            0.6B |              1.7B |                  4B |
| ------------------------------- | --------------: | ----------------: | ------------------: |
| Precisión de campo              | 49.8% (150/301) |   49.1% (140/285) | **63.4% (185/292)** |
| Casos con aprobación total      |            0/30 |              0/30 |            **3/30** |
| Fabricados                      |              46 |                59 |              **42** |
| Faltantes                       |              40 |                14 |               **8** |
| Incorrectos                     |              45 |                33 |              **29** |
| Normalización                   |               7 |                10 |               **7** |
| Seguimiento (follow-up)         |          **13** |                29 |                  21 |
| Errores de extracción           |               0 |                 0 |                   0 |
| Precisión de campo, inglés      | 53.9% (118/219) |   53.8% (114/212) | **62.4% (136/218)** |
| Precisión de campo, español     |   39.0% (32/82) |     35.6% (26/73) |   **66.2% (49/74)** |
| Precisión de campo, adversarial |   52.0% (39/75) | **67.6% (50/74)** |       65.3% (49/75) |
| ¿Se emitió `Uncertain`?         |              No |                No |                  No |
| Carga del modelo                |        6,815 ms |         56,157 ms |          162,579 ms |
| Latencia p50                    |        2,312 ms |      **2,241 ms** |            3,383 ms |
| Latencia p95                    |        6,249 ms |      **2,819 ms** |            6,744 ms |
| Latencia máxima                 |        7,185 ms |      **3,238 ms** |           17,013 ms |

Frente al 1.7B, el 4B mejora la precisión general de campo en **14.2 puntos porcentuales** (redondeando los
porcentajes mostrados da 14.3 puntos), produce los únicos tres casos con aprobación total, y reduce las
fallas de fabricación, faltantes, incorrectas, de normalización y de seguimiento. Esta es una mejora material de calidad,
especialmente en español (+30.6 puntos porcentuales), aunque la precisión adversarial cae
2.2 puntos y `Uncertain` todavía nunca se emite. No cumple con el estándar de calidad declarado: 27 de
30 casos siguen fallando y quedan 42 valores fabricados.

La ganancia de calidad conlleva un costo grande frente al 1.7B: el artefacto de registro es 2.36 veces más grande,
la carga del modelo es 2.90 veces más larga, la latencia p50 es 51% más alta, la p95 es 139% más alta, y la latencia
máxima es 425% más alta. Los objetivos numéricos de rendimiento siguen siendo por determinar, así que el estado del presupuesto
sigue siendo **por determinar**. Dado que la mejora de calidad del 4B sobre el 1.7B es material, la instrucción
condicional de cerrar la exploración de modelos no aplica; esta comparación no cambia el valor por defecto de producción desde el 0.6B.

### 2026-09-10 — P4-S4/P4-S5, intento inicial del 1.7B (histórico; reemplazado arriba)

Entorno: misma máquina que la línea base P4-S3 de abajo; Node 24.20.0 vía el
`.tools/node-v24.20.0-win-x64` empaquetado; se asume alimentación de red eléctrica (no confirmado).

`npm run corpus:eval` se volvió a ejecutar contra `QWEN3_600M_INST_Q4` con el runner instrumentado para
medir latencia. Resultado: **0 / 30 casos pasaron, 49.8% de precisión de campo (150 / 301 campos)** — distinto de
la línea base de 43.8% de P4-S3 de abajo, lo cual es la varianza esperada de ejecución a ejecución por el muestreo
no determinista de QVAC sobre el mismo modelo, entrada y prompt (ver `docs/TESTING.md`: "un `npm test` en verde no es
evidencia de que QVAC funcione" aplica igualmente a cualquier ejecución no determinista aislada). Detalle completo en
`docs/qvac-eval-runs/600m-2026-09-10T12-59-49-257Z.json`.

| Métrica                               | Valor                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tiempo de carga del modelo            | 6,815 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Latencia por caso, p50                | 2,312 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Latencia por caso, p95                | 6,249 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Latencia por caso, máxima             | 7,185 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Tiempo total de evaluación (30 casos) | 82,449 ms                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Tamaño del archivo del modelo         | 382,156,480 B ≈ 365 MiB                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| RSS pico durante la inferencia        | **No medido** — `@qvac/sdk` ejecuta la inferencia en un proceso worker separado conectado por IPC (`dist/src/worker/lifecycle.js`), así que la memoria del propio proceso de este script no lo refleja. Medirlo de forma confiable necesita la superficie `getSystemResources()`/`profiler` del SDK, ya señalada en este documento como propuesta pero no integrada — no construida aquí, siguiendo la instrucción de no inventar mediciones de memoria |

En el momento de este primer intento, la **comparación con el 1.7B (`QWEN3_1_7B_INST_Q4`) estuvo bloqueada y
no se completó.** El modelo aún no estaba en caché
localmente; la descarga del registro se estancó en 0 bytes durante más de 15 minutos con uso de CPU del worker casi nulo,
consistente con que el transporte de registro entre pares (peer-to-peer) del SDK no encontrara pares para este blob en
este entorno de red (detalle y opciones en
[MODEL_STRATEGY.md](MODEL_STRATEGY.md#intento-inicial-de-escalado-2026-09-10--bloqueador-histórico-resuelto-posteriormente)).
No existían números del 1.7B en ese momento. Este bloqueador histórico se resolvió posteriormente; los
resultados completados del 1.7B y del 4B están en la sección de comparación de arriba.

### 2026-09-10 — línea base de precisión de extracción P4-S3, `extraction-corpus-v1`

`npm run corpus:eval` contra `QWEN3_600M_INST_Q4` (el modelo de completado por defecto), 30 casos del
corpus. El detalle completo, incluyendo cada campo fallido por caso, está en
`docs/qvac-eval-runs/2026-09-10T06-01-35-961Z.json`.

| Métrica                                 | Valor                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Casos aprobados                         | 1 / 30                                                                       |
| Precisión de campo (general)            | 43.8% (127 / 290 campos)                                                     |
| official-workbook                       | 1 / 13 casos, 50.4% de precisión de campo                                    |
| challenge-brief                         | 0 / 4 casos, 35.2% de precisión de campo                                     |
| project-authored                        | 0 / 13 casos, 40.5% de precisión de campo                                    |
| Inglés                                  | 1 / 18 casos, 45.9% de precisión de campo                                    |
| Español                                 | 0 / 12 casos, 37.1% de precisión de campo                                    |
| Adversarial (P4-S2, 8 casos)            | 0 / 8 casos, 52.0% de precisión de campo                                     |
| Valores fabricados                      | 53                                                                           |
| Valores esperados faltantes             | 30                                                                           |
| Valores incorrectos                     | 53                                                                           |
| Fallas de normalización                 | 6                                                                            |
| Fallas de seguimiento                   | 19                                                                           |
| Errores de extracción/JSON              | 2 de 30 llamadas ("Unterminated string in JSON", salida del modelo truncada) |
| ¿Se vio alguna vez certeza `Uncertain`? | **No** — ver el hallazgo `E-11` abajo                                        |

Esta es la fila de tasa de éxito de salida estructurada de arriba, completada por primera vez: **43.8% de
precisión de campo**, muy por debajo de un estándar de calidad utilizable. Según `docs/ROADMAP.md`, P4-S3, esto
se registra como línea base, no se corrige aquí — no se hizo ningún cambio de prompt, modelo o cuantización para
producirlo. Ver [MODEL_STRATEGY.md](MODEL_STRATEGY.md) para la pregunta de escalado que esto plantea.
