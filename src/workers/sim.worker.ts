import { CompiledPattern, SolvedGeometry } from '../core/model/types';
import { solveStitchGeometry } from '../core/physics/solver';

export interface SimWorkerRequest {
  requestId: number;
  pattern: CompiledPattern;
  stuffingOverride: boolean | null;
}

export interface SimWorkerResponse {
  requestId: number;
  geometry: SolvedGeometry;
}

self.onmessage = (event: MessageEvent<SimWorkerRequest>) => {
  const { requestId, pattern, stuffingOverride } = event.data;
  const geometry = solveStitchGeometry(pattern, {
    iterations: 30,
    stuffingOverride,
  });

  const response: SimWorkerResponse = {
    requestId,
    geometry,
  };

  (self as unknown as Worker).postMessage(response, [
    geometry.positions.buffer,
    geometry.tangents.buffer,
    geometry.normals.buffer,
    geometry.stress.buffer,
  ]);
};
