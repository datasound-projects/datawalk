import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { currentRoomLayout } from './editor/arrangeOps'
import { pose, requestTeleport } from './navigation/pose'
import { useViewer } from './state/store'
import { exportHooks } from './export/hooks'
import { goTo, tourStops } from './tour/tour'
import './styles.css'

// Access for end-to-end tests, theme thumbnails and debugging.
Object.assign(window, {
  datawalk: useViewer,
  datawalkPose: pose,
  datawalkTeleport: requestTeleport,
  datawalkLayout: currentRoomLayout,
  datawalkTour: { tourStops: () => tourStops(useViewer.getState().report!), goTo },
  datawalkExport: exportHooks, // PPTX images and world files (Python drives a headless browser)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
