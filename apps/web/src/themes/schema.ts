// Theme files: assets/themes/<id>/theme.json (look) and room.json (geometry).
// Library ids refer to assets in assets/library (see assets/manifest.json).
import { z } from 'zod'
import { WALLS } from '../state/schema'

const Color = z.string().regex(/^#[0-9a-f]{6}$/i)
const Fraction = z.number().min(0).max(1)

export const Surface = z.strictObject({
  material: z.string().nullable(), // library material id; null: plain color
  color: Color.default('#ffffff'), // multiplies the texture color
  tile: z.number().positive().default(2), // meters per texture repeat
  roughness: z.number().min(0).max(3).default(1), // multiplies the texture roughness (above 1: more matte)
  metalness: z.number().min(0).max(1).default(0),
  normalScale: z.number().min(0).default(1),
})

export const DISPLAY_STYLES = [
  'premium', // dark wood frame, brass plaque
  'monitor', // slim black bezel
  'gallery', // thin frame with a white mat
  'gallery_dark', // black frame
  'steel', // raw steel frame
  'frameless',
  'museum', // brass frame
  'glass', // glass slab with glowing edges
  'floating', // white backing panel
  'led', // LED wall with a thin bezel
] as const

export const ThemeSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  lighting: z.strictObject({
    environment: z.string(), // library HDRI id, image-based lighting
    environmentIntensity: z.number().positive(),
    exposure: z.number().positive(),
    view: z.string().nullable(), // library view id, seen through windows and skylights
    viewIntensity: z.number().positive().default(1),
    viewRotation: z.number().default(0), // degrees: turns the view so its best side shows through the windows
    // Ceiling glow that stands in for light bounced off the floor and walls (no baked lighting).
    ceilingBounce: z.number().min(0).max(1).default(0.15),
    sun: z
      .strictObject({ direction: z.tuple([z.number(), z.number(), z.number()]), color: Color, intensity: z.number() })
      .nullable(),
    ambient: z.strictObject({ sky: Color, ground: Color, intensity: z.number().min(0) }),
    fixtures: z.enum(['downlights', 'panels', 'tracks', 'pendants', 'strips', 'none']),
    fixtureColor: Color,
    fixtureIntensity: z.number().min(0), // candela of each ceiling light
    accent: z.strictObject({ color: Color, intensity: z.number().min(0) }).nullable(), // LED strips
  }),
  surfaces: z.strictObject({
    floor: Surface,
    walls: Surface,
    ceiling: Surface,
    wainscot: Surface.extend({ height: z.number().positive() }).nullable(),
    trim: Color,
    rug: Surface.nullable(),
  }),
  display: z.strictObject({
    style: z.enum(DISPLAY_STYLES),
    frame: Color,
    plaque: z.strictObject({ background: Color, text: Color }),
    spotlight: z.boolean(), // a light pool on the wall around each display
    glow: Color.nullable(),
  }),
  door: z.strictObject({ color: Color, frame: Color }),
  // Thumbnail camera: positions as fractions of the room (x: west -> east, z: north -> south).
  preview: z.strictObject({ from: z.tuple([Fraction, Fraction]), to: z.tuple([Fraction, Fraction]) }).default({ from: [0.7, 0.85], to: [0.25, 0.2] }),
})

const Anchor = z.union([
  // Corner: distance from both walls to the item's footprint.
  z.strictObject({ corner: z.enum(['nw', 'ne', 'sw', 'se']), inset: z.number().min(0).default(0.15) }),
  // Against a wall at a fraction of its length (viewer's left = 0).
  z.strictObject({ wall: z.enum(WALLS), at: Fraction, inset: z.number().min(0).default(0.1) }),
  // Free position as fractions of the room (x: west -> east, z: north -> south).
  z.strictObject({ x: Fraction, z: Fraction }),
])

export const FurnitureSchema = z.strictObject({
  model: z.string(), // library model id
  anchor: Anchor,
  rotation: z.number().default(0), // degrees about the vertical axis, before anchoring
  scale: z.number().positive().default(1),
  elevation: z.number().default(0), // meters above the floor (items on plinths or desks)
  plinth: z.strictObject({ size: z.tuple([z.number(), z.number(), z.number()]), color: Color }).nullable().default(null),
  collide: z.boolean().default(true),
})

export const RoomSchema = z.strictObject({
  height: z.number().min(2.6).max(8),
  minSize: z.tuple([z.number().min(8), z.number().min(6)]),
  windows: z
    .array(
      z.strictObject({
        wall: z.enum(WALLS),
        from: Fraction,
        to: Fraction,
        sill: z.number().min(0),
        head: z.number().positive(),
        mullions: z.number().int().min(0).default(0),
        frame: Color,
        // Displays may hang in front of curtain walls (glass pavilion); otherwise windows block them.
        displayable: z.boolean().default(false),
      }),
    )
    .default([]),
  skylight: z.strictObject({ size: z.tuple([Fraction, Fraction]), frame: Color, mullions: z.number().int().min(0) }).nullable().default(null),
  pilasters: z.strictObject({ spacing: z.number().positive(), width: z.number().positive(), depth: z.number().positive(), color: Color }).nullable().default(null),
  beams: z.strictObject({ spacing: z.number().positive(), depth: z.number().positive(), color: Color }).nullable().default(null),
  rug: z.strictObject({ anchor: Anchor, size: z.tuple([z.number(), z.number()]) }).nullable().default(null), // size: along the wall, out from it
  benches: z.strictObject({ color: Color, seat: Color }).nullable().default(null),
  furniture: z.array(FurnitureSchema).default([]),
  pendants: z.strictObject({ model: z.string(), drop: z.number().min(0) }).nullable().default(null), // drop: ceiling to model origin
})

export type Theme = z.infer<typeof ThemeSchema>
export type RoomSpec = z.infer<typeof RoomSchema>
export type SurfaceSpec = z.infer<typeof Surface>
export type FurnitureSpec = z.infer<typeof FurnitureSchema>
export type DisplayStyle = (typeof DISPLAY_STYLES)[number]

export const LibrarySchema = z.strictObject({
  models: z.record(z.string(), z.strictObject({ min: z.tuple([z.number(), z.number(), z.number()]), max: z.tuple([z.number(), z.number(), z.number()]) })),
  materials: z.array(z.string()),
  hdris: z.array(z.string()),
  views: z.array(z.string()),
  // Asset credits for the lobby (CC0 needs none; we credit the authors as a courtesy).
  credits: z.record(z.string(), z.strictObject({ name: z.string(), authors: z.array(z.string()), source: z.string(), license: z.string() })).default({}),
})
export type Library = z.infer<typeof LibrarySchema>
