import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type InstalledBaseApi } from '@/shared';

const api: InstalledBaseApi = {
  getInferenceStatus: () => ipcRenderer.invoke(IPC_CHANNELS.inferenceStatus),
  initializeInference: () => ipcRenderer.invoke(IPC_CHANNELS.inferenceInitialize),
  startCapture: (source = 'Text') => ipcRenderer.invoke(IPC_CHANNELS.captureStart, { source }),
  submitCaptureMessage: (captureId, text) =>
    ipcRenderer.invoke(IPC_CHANNELS.captureSubmit, { captureId, text }),
  correctCapture: (captureId, correction) =>
    ipcRenderer.invoke(IPC_CHANNELS.captureCorrect, { captureId, correction }),
  proceedToReview: (captureId) => ipcRenderer.invoke(IPC_CHANNELS.captureReview, { captureId }),
  saveCapture: (captureId) => ipcRenderer.invoke(IPC_CHANNELS.captureSave, { captureId }),
  listCustomers: () => ipcRenderer.invoke(IPC_CHANNELS.customersList),
  getCustomer360: (customerId) => ipcRenderer.invoke(IPC_CHANNELS.customer360, { customerId }),
  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard),
};

contextBridge.exposeInMainWorld('installedBaseApi', api);
