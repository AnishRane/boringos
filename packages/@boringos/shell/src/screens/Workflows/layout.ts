// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auto-layout via elkjs. Left-to-right layered layout, snug spacing
// to match the sleek node aesthetic.

import ELK from "elkjs/lib/elk.bundled.js";
import type { Block, Edge } from "./types.js";
import { blockKind, edgeId } from "./utils.js";

const elk = new ELK();

const NODE_W = 152;
const NODE_H_DEFAULT = 38;
const NODE_H_TOOL = 50;
const NODE_H_STICKY = 80;

function nodeHeight(b: Block): number {
  const k = blockKind(b);
  if (k === "tool" || k === "for_each") return NODE_H_TOOL;
  if (k === "sticky") return NODE_H_STICKY;
  return NODE_H_DEFAULT;
}

export interface LaidOut {
  positions: Record<string, { x: number; y: number }>;
}

export async function autoLayout(
  blocks: Block[],
  edges: Edge[],
): Promise<LaidOut> {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.spacing.nodeNode": "28",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.semiInteractive": "true",
    },
    children: blocks.map((b) => ({
      id: b.id,
      width: NODE_W,
      height: nodeHeight(b),
    })),
    edges: edges.map((e, i) => ({
      id: edgeId(e) || `e_${i}`,
      sources: [e.sourceBlockId],
      targets: [e.targetBlockId],
    })),
  };
  const out = await elk.layout(graph);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of out.children ?? []) {
    if (child.id) positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return { positions };
}
