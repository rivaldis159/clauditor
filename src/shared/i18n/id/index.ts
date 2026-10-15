// Indonesian dictionary, split by area so each part of the UI keeps its own list.
// Keys are the exact English source strings used in code.
import { agent } from './agent'
import { common } from './common'
import { main } from './main'
import { pages } from './pages'
import { state } from './state'
import { workbench } from './workbench'

export const id: Record<string, string> = { ...common, ...workbench, ...agent, ...pages, ...state, ...main }
