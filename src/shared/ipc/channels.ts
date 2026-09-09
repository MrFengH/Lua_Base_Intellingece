export const IPC_CHANNELS = {
  inferenceStatus: 'inference:get-status',
  inferenceInitialize: 'inference:initialize',
  captureStart: 'capture:start',
  captureSubmit: 'capture:submit-message',
  captureCorrect: 'capture:correct',
  captureReview: 'capture:proceed-to-review',
  captureSave: 'capture:save',
  customersList: 'customers:list',
  customer360: 'customers:get-360',
  dashboard: 'dashboard:get',
} as const;
