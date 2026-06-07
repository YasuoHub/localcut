import { applyEdgeRefinements } from '../utils/mattingPostProcess'

type WorkerRequest = {
  type: 'process_edges'
  id: number
  mask: Uint8ClampedArray
  width: number
  height: number
  expand: number
  contract: number
  feather: number
}

type WorkerResponse = {
  type: 'edges_processed'
  id: number
  mask: Uint8ClampedArray
  error?: string
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'process_edges') return

  try {
    const refined = applyEdgeRefinements(
      msg.mask,
      msg.width,
      msg.height,
      msg.expand,
      msg.contract,
      msg.feather,
    )

    const response: WorkerResponse = {
      type: 'edges_processed',
      id: msg.id,
      mask: refined,
    }

    // Transfer the result buffer back (zero-copy)
    ;(self as unknown as Worker).postMessage(response, [refined.buffer])
  } catch (err: any) {
    const response: WorkerResponse = {
      type: 'edges_processed',
      id: msg.id,
      mask: msg.mask, // return original on error
      error: err.message || 'Edge refinement failed',
    }
    ;(self as unknown as Worker).postMessage(response, [msg.mask.buffer])
  }
}
