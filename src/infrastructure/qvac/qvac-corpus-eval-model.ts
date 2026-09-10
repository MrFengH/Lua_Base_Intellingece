/**
 * Benchmark-only model export. Keeping it outside the production adapter lets `corpus:eval`
 * verify and select the installed SDK descriptor without widening production model selection.
 */
export { QWEN3_4B_INST_Q4_K_M } from '@qvac/sdk';
