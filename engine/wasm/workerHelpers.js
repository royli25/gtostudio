function waitForMsgType(target, type) {
  return new Promise((resolve) => {
    target.addEventListener("message", function onMsg({ data }) {
      if (data == null || data.type !== type) return;
      target.removeEventListener("message", onMsg);
      resolve(data);
    });
  });
}

waitForMsgType(self, "wasm_bindgen_worker_init").then(async (data) => {
  const pkg = await import("../../solver_wasm.js");
  await pkg.default({
    module_or_path: data.module,
    memory: data.memory,
    thread_stack_size: 1048576,
  });
  postMessage({ type: "wasm_bindgen_worker_ready" });
  pkg.wbg_rayon_start_worker(data.receiver);
  postMessage({ type: "wasm_bindgen_worker_done" });
});

let workers;

export async function startWorkers(module, memory, builder) {
  if (builder.numThreads() === 0) {
    throw new Error("num_threads must be > 0.");
  }

  const workerInit = {
    type: "wasm_bindgen_worker_init",
    module,
    memory,
    receiver: builder.receiver(),
  };

  workers = await Promise.all(
    Array.from({ length: builder.numThreads() }, async () => {
      const worker = new Worker(
        new URL("./workerHelpers.js", import.meta.url),
        { type: "module" }
      );
      worker.postMessage(workerInit);
      await waitForMsgType(worker, "wasm_bindgen_worker_ready");
      return worker;
    })
  );
  builder.build();
}

export function terminateWorkers() {
  return Promise.all(
    workers.map(async (worker) => {
      await waitForMsgType(worker, "wasm_bindgen_worker_done");
      worker.terminate();
    })
  );
}
