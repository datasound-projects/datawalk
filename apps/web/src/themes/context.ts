import { createContext } from 'react'
import type { Theme } from './schema'

/** Display style of the current room's theme. */
export const DisplayContext = createContext<Theme['display'] | null>(null)
