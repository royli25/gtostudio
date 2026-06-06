mod solver;

use solver::SolverState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SolverState::default())
        .invoke_handler(tauri::generate_handler![
            solver::solver_cancel,
            solver::solver_extract_tree,
            solver::solver_game_info,
            solver::solver_get_results,
            solver::solver_init,
            solver::solver_list_local_metadata,
            solver::solver_lock_current_node,
            solver::solver_save_local_metadata,
            solver::solver_solve,
            solver::solver_status,
            solver::solver_unlock_current_node,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
