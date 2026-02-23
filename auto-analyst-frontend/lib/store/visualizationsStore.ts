import { create } from 'zustand'

type PlotlyViz = { 
  id: string; 
  type: 'plotly'; 
  data: any[]; 
  layout?: any; 
  title?: string; 
  createdAt: number;
  updatedAt: number;
  codeHash: string;
}

type MplViz = { 
  id: string; 
  type: 'matplotlib'; 
  imageData: string; 
  title?: string; 
  createdAt: number;
  updatedAt: number;
  codeHash: string;
}

export type Viz = PlotlyViz | MplViz

// Simple hash function for code content
const hashCode = (str: string): string => {
  let hash = 0;
  if (str.length === 0) return '0';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Ensure consistent positive hash
  return Math.abs(hash).toString();
}

export const useVisualizationsStore = create<{
  visualizations: Viz[]
  addOrUpdatePlotly: (data: any[], layout?: any, title?: string, code?: string) => void
  addOrUpdateMatplotlib: (imageData: string, title?: string, code?: string) => void
  unpinVisualization: (codeHashOrCode: string) => void
  clear: () => void
}>((set) => ({
  visualizations: [],
  
  addOrUpdatePlotly: (data, layout, title, code = '') =>
    set((s) => {
      const codeHash = hashCode(code);
      const now = Date.now();
      
      // Find existing visualization with same code hash
      const existingIndex = s.visualizations.findIndex(viz => viz.codeHash === codeHash);
      
      if (existingIndex >= 0) {
        // UPDATE: Replace the existing visualization with new data
        console.log(`Updating existing Plotly visualization for code hash: ${codeHash}`);
        const updatedVisualizations = [...s.visualizations];
        updatedVisualizations[existingIndex] = {
          ...updatedVisualizations[existingIndex],
          data,
          layout,
          title,
          updatedAt: now,
        } as PlotlyViz;
        
        // Sort by updatedAt (latest first)
        updatedVisualizations.sort((a, b) => b.updatedAt - a.updatedAt);
        
        return { visualizations: updatedVisualizations };
      } else {
        // ADD: Create new visualization
        console.log(`Adding new Plotly visualization for code hash: ${codeHash}`);
        const newViz: PlotlyViz = {
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'plotly',
          data,
          layout,
          title,
          createdAt: now,
          updatedAt: now,
          codeHash,
        };
        
        // Add to beginning and sort by updatedAt
        const newVisualizations = [newViz, ...s.visualizations];
        newVisualizations.sort((a, b) => b.updatedAt - a.updatedAt);
        
        return { visualizations: newVisualizations };
      }
    }),
    
  addOrUpdateMatplotlib: (imageData, title, code = '') =>
    set((s) => {
      const codeHash = hashCode(code);
      const now = Date.now();
      
      // Find existing visualization with same code hash
      const existingIndex = s.visualizations.findIndex(viz => viz.codeHash === codeHash);
      
      if (existingIndex >= 0) {
        // UPDATE: Replace the existing visualization with new data
        console.log(`Updating existing Matplotlib visualization for code hash: ${codeHash}`);
        const updatedVisualizations = [...s.visualizations];
        updatedVisualizations[existingIndex] = {
          ...updatedVisualizations[existingIndex],
          imageData,
          title,
          updatedAt: now,
        } as MplViz;
        
        // Sort by updatedAt (latest first)
        updatedVisualizations.sort((a, b) => b.updatedAt - a.updatedAt);
        
        return { visualizations: updatedVisualizations };
      } else {
        // ADD: Create new visualization
        console.log(`Adding new Matplotlib visualization for code hash: ${codeHash}`);
        const newViz: MplViz = {
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'matplotlib',
          imageData,
          title,
          createdAt: now,
          updatedAt: now,
          codeHash,
        };
        
        // Add to beginning and sort by updatedAt
        const newVisualizations = [newViz, ...s.visualizations];
        newVisualizations.sort((a, b) => b.updatedAt - a.updatedAt);
        
        return { visualizations: newVisualizations };
      }
    }),

  unpinVisualization: (codeHashOrCode: string) =>
    set((s) => {
      // If it's already a hash (from dashboard), use directly
      // If it's code (from chat), hash it first
      const codeHash = codeHashOrCode.length < 20 && !codeHashOrCode.includes('\n') 
        ? codeHashOrCode  // Already a hash
        : hashCode(codeHashOrCode); // Need to hash the code
      
      console.log(`Unpinning visualization for code hash: ${codeHash}`);
      
      // Remove visualization with matching code hash
      const filteredVisualizations = s.visualizations.filter(viz => viz.codeHash !== codeHash);
      
      return { visualizations: filteredVisualizations };
    }),
    
  clear: () => set({ visualizations: [] }),
}))
