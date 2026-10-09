// Stand-in for Plotly and Vega in the lite export viewer (`vite build --mode viewer-lite`).
// Python picks that viewer only for reports without Plotly and Vega-Lite charts, so these
// modules are never used there; if they are, the error says why.
const missing = (): never => {
  throw new Error('This export has no chart library for this chart. Export it again with DataWalk.')
}
export default new Proxy({}, { get: missing })
export const loader = missing
export const View = missing
export const parse = missing
export const compile = missing
