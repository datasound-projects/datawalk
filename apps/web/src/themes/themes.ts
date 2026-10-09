import type { THEMES } from '../state/schema'

export type ThemeId = (typeof THEMES)[number]

// Names of the ten room themes (their descriptions are UI text: i18n keys theme.<id>).
// The authored room assets are not built yet; every theme currently renders the standard room.
export const THEME_INFO: Record<ThemeId, { name: string }> = {
  executive_office: { name: 'Executive Office' },
  home_office: { name: 'Home Office' },
  light_gallery: { name: 'Light Gallery' },
  dark_gallery: { name: 'Dark Gallery' },
  industrial_loft: { name: 'Industrial Loft' },
  minimalist_studio: { name: 'Minimalist Studio' },
  museum_atrium: { name: 'Museum Atrium' },
  futuristic_lab: { name: 'Futuristic Lab' },
  metaverse_pavilion: { name: 'Metaverse Pavilion' },
  data_command_center: { name: 'Data Command Center' },
}
