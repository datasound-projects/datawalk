// Runtime validation for data from the Python package. Mirrors
// packages/python/datawalk/core/models.py; schema.test.ts keeps the two in sync.
import { z } from 'zod'

export const THEMES = [
  'executive_office',
  'home_office',
  'light_gallery',
  'dark_gallery',
  'industrial_loft',
  'minimalist_studio',
  'museum_atrium',
  'futuristic_lab',
  'metaverse_pavilion',
  'data_command_center',
] as const

const Id = z.string().regex(/^[0-9a-f]{32}$/)
const ThemeId = z.enum(THEMES)

const Axis = z.strictObject({ label: z.string(), scale: z.string() })

const AxesInfo = z.strictObject({
  title: z.string(),
  x: Axis,
  y: Axis,
  z: Axis.nullable(),
  legend: z.array(z.string()),
})

const Provenance = z.strictObject({
  kind: z.enum(['notebook', 'file', 'mlflow']),
  path: z.string(),
  sha256: z.string(),
  cell_id: z.string().nullable(),
  output_index: z.number().int().nullable(),
  execution_count: z.number().int().nullable(),
  code: z.string(),
})

const Source = z.strictObject({
  library: z.string(),
  chart_type: z.string(),
  mode: z.enum(['interactive', 'structured', 'static']),
  title: z.string().nullable(),
  axes: z.array(AxesInfo),
  aspect: z.number().positive(),
  default_name: z.string(),
  limitations: z.array(z.string()),
  has_preview: z.boolean(),
  has_payload: z.boolean(),
  provenance: Provenance.nullable(),
})

const Explanation = z.strictObject({
  what_it_shows: z.string(),
  inputs: z.string(),
  units: z.string(),
  data_source: z.string(),
  findings: z.array(z.string()),
  interpretation: z.string(),
  methodology: z.string(),
  assumptions: z.string(),
  limitations: z.string(),
  author: z.string(),
})

const Visualization = z.strictObject({
  id: Id,
  key: z.string().min(1),
  source: Source,
  overrides: z.strictObject({
    name: z.string().nullable(),
    description: z.string(),
    explanation: Explanation,
    edited: z.array(z.string()), // set by the server: fields a person edited
  }),
  status: z.enum(['active', 'removed']),
})

export const WALLS = ['north', 'east', 'south', 'west'] as const

const Placement = z.strictObject({
  wall: z.enum([...WALLS, 'floor']), // 'floor': freestanding 3D exhibits
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
  width: z.number().positive().max(20),
  locked: z.boolean(),
})

const Room = z.strictObject({
  id: Id,
  key: z.string().nullable(),
  name: z.string().min(1),
  description: z.string(),
  theme: ThemeId.nullable(),
  items: z.array(Id),
  placements: z.record(Id, Placement),
})

const Dashboard = z.strictObject({
  id: Id,
  key: z.string().nullable(),
  name: z.string().min(1),
  description: z.string(),
  items: z.array(Id),
})

const Link = z.strictObject({
  id: Id,
  key: z.string().nullable(),
  name: z.string().min(1),
  items: z.array(Id).min(2),
  on: z.literal('x'),
})

const Dataset = z.strictObject({
  id: Id,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  columns: z.array(z.string()),
  rows: z.number().int().nonnegative(),
  visualizations: z.array(Id),
})

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const Brand = z.strictObject({
  name: z.string(),
  frame: Hex.nullable(),
  plaque: Hex.nullable(),
  plaque_text: Hex.nullable(),
  accent: Hex.nullable(),
  has_logo: z.boolean(),
})

const TourStop = z.strictObject({
  id: Id,
  ref: Id, // visualization, dashboard, or room id
  notes: z.string(), // speaker notes
  duration: z.number().positive().max(3600).nullable(), // seconds, for auto-play
})

export const ReportSchema = z.strictObject({
  schema_version: z.string().regex(/^0\.3\./),
  id: Id,
  name: z.string().min(1),
  description: z.string(),
  author: z.string(),
  date: z.string(),
  data_cutoff: z.string(),
  classification: z.string().max(60), // label shown in every view and export
  theme: ThemeId,
  revision: z.number().int(),
  visualizations: z.array(Visualization),
  dashboards: z.array(Dashboard),
  rooms: z.array(Room),
  links: z.array(Link),
  datasets: z.array(Dataset),
  tour: z.array(TourStop),
  brand: Brand.nullable(), // customer brand: logo, frame and plaque colors
  edited: z.array(z.string()), // set by the server
})

const Value = z.union([z.number(), z.string(), z.null()])

export const PayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('series'),
    series: z.array(
      z.strictObject({
        axes: z.number().int().nonnegative(),
        name: z.string(),
        kind: z.enum(['line', 'scatter']),
        x: z.array(Value),
        y: z.array(Value),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal('plotly'),
    figure: z.looseObject({
      data: z.array(z.record(z.string(), z.unknown())),
      layout: z.record(z.string(), z.unknown()).optional(),
      frames: z.array(z.unknown()).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('kpi'),
    value: z.union([z.number(), z.string(), z.null()]),
    display: z.string(),
    unit: z.string(),
    delta: z.number().nullable(),
    delta_display: z.string(),
    higher_is_better: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('table'),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.number(), z.string(), z.boolean(), z.null()]))),
    total_rows: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('vegalite'),
    spec: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    kind: z.literal('svg'),
    svg: z.string(),
  }),
  z.strictObject({
    kind: z.literal('bokeh'),
    item: z.record(z.string(), z.unknown()),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  }),
  z.strictObject({
    kind: z.literal('text'),
    markdown: z.string().max(20_000),
    links: z.array(z.string()), // keys of supporting visualizations
  }),
])

export type Report = z.infer<typeof ReportSchema>
export type Visualization = z.infer<typeof Visualization>
export type Room = z.infer<typeof Room>
export type Dashboard = z.infer<typeof Dashboard>
export type Link = z.infer<typeof Link>
export type Dataset = z.infer<typeof Dataset>
export type Placement = z.infer<typeof Placement>
export type Wall = (typeof WALLS)[number]
export type Payload = z.infer<typeof PayloadSchema>
export type Explanation = Visualization['overrides']['explanation']
export type TourStop = z.infer<typeof TourStop>
export type Brand = z.infer<typeof Brand>

export const displayName = (v: Visualization) => v.overrides.name || v.source.default_name
