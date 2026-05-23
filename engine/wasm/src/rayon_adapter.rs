use js_sys::Promise;
use spmc::{channel, Receiver, Sender};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

#[allow(non_camel_case_types)]
#[wasm_bindgen]
pub struct wbg_rayon_PoolBuilder {
    num_threads: usize,
    sender: Sender<rayon::ThreadBuilder>,
    receiver: Receiver<rayon::ThreadBuilder>,
}

#[wasm_bindgen(module = "/workerHelpers.js")]
extern "C" {
    #[wasm_bindgen(js_name = startWorkers)]
    fn start_workers(module: JsValue, memory: JsValue, builder: wbg_rayon_PoolBuilder) -> Promise;
    #[wasm_bindgen(js_name = terminateWorkers)]
    fn terminate_workers() -> Promise;
}

pub static mut THREAD_POOL_READY: bool = false;

#[wasm_bindgen]
impl wbg_rayon_PoolBuilder {
    fn new(num_threads: usize) -> Self {
        let (sender, receiver) = channel();
        Self {
            num_threads,
            sender,
            receiver,
        }
    }

    #[wasm_bindgen(js_name = numThreads)]
    pub fn num_threads(&self) -> usize {
        self.num_threads
    }

    pub fn receiver(&self) -> *const Receiver<rayon::ThreadBuilder> {
        &self.receiver
    }

    pub fn build(&mut self) {
        rayon::ThreadPoolBuilder::new()
            .num_threads(self.num_threads)
            .spawn_handler(move |thread| {
                self.sender.send(thread).unwrap_throw();
                Ok(())
            })
            .build_global()
            .unwrap_throw();
        unsafe {
            THREAD_POOL_READY = true;
        }
    }
}

#[wasm_bindgen(js_name = initThreadPool)]
pub fn init_thread_pool(num_threads: usize) -> Promise {
    unsafe {
        if THREAD_POOL_READY {
            panic!("Thread pool is already initialized");
        }
    }
    start_workers(
        wasm_bindgen::module(),
        wasm_bindgen::memory(),
        wbg_rayon_PoolBuilder::new(num_threads),
    )
}

#[wasm_bindgen(js_name = exitThreadPool)]
pub fn exit_thread_pool() -> Promise {
    unsafe {
        if !THREAD_POOL_READY {
            panic!("Thread pool is not initialized");
        }
        let promise = terminate_workers();
        THREAD_POOL_READY = false;
        promise
    }
}

#[wasm_bindgen]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn wbg_rayon_start_worker(receiver: *const Receiver<rayon::ThreadBuilder>)
where
    Receiver<rayon::ThreadBuilder>: Sync,
{
    let receiver = unsafe { &*receiver };
    receiver.recv().unwrap_throw().run()
}
