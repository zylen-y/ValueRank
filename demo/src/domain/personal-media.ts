/** Fixed visual attributes from actual image pixels, never from a filename. */
export const VISUAL_FEATURE_NAMES = ['brightness', 'contrast', 'saturation', 'warmth', 'minimalism', 'symmetry', 'organicForms', 'geometricForms', 'visualDensity', 'softness', 'depth', 'humanPresence', 'closeCrop', 'expressionWarmth', 'formality', 'naturalSetting'] as const;
export const VISUAL_SCHEMA = 'visual-observations-v1';
export interface ImageImportItem { title: string; entityId?: string; dataUrl: string; sourceUrl?: string; rights?: string }
export interface ImageImportInput { name: string; domain: string; question: string; items: ImageImportItem[] }
export interface ImageImportJob {
  id: string; status: 'running' | 'completed' | 'failed' | 'cancelled';
  name: string; domain: string; completed: number; total: number;
  createdAt: string; updatedAt: string; datasetId?: string; error?: string;
  model: string; tokens: number;
}
