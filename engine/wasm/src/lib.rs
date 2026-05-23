use postflop_solver::*;
use rayon::prelude::*;
use wasm_bindgen::prelude::*;

mod rayon_adapter;

#[wasm_bindgen]
pub struct GameManager {
    game: PostFlopGame,
}

#[wasm_bindgen]
impl GameManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            game: PostFlopGame::new(),
        }
    }

    pub fn init(
        &mut self,
        oop_range: &str,
        ip_range: &str,
        board: &[u8],
        starting_pot: i32,
        effective_stack: i32,
        rake_rate: f64,
        rake_cap: f64,
        oop_flop_bet: &str,
        oop_flop_raise: &str,
        ip_flop_bet: &str,
        ip_flop_raise: &str,
        oop_turn_bet: &str,
        oop_turn_raise: &str,
        ip_turn_bet: &str,
        ip_turn_raise: &str,
        oop_river_bet: &str,
        oop_river_raise: &str,
        ip_river_bet: &str,
        ip_river_raise: &str,
        add_allin_threshold: f64,
        force_allin_threshold: f64,
        merging_threshold: f64,
    ) -> Result<(), JsError> {
        let oop: Range = oop_range.parse().map_err(|e: String| JsError::new(&e))?;
        let ip: Range = ip_range.parse().map_err(|e: String| JsError::new(&e))?;

        let board_len = board.len();
        let mut flop = [0u8; 3];
        flop.copy_from_slice(&board[..3]);
        let turn = if board_len >= 4 { board[3] } else { NOT_DEALT };
        let river = if board_len >= 5 { board[4] } else { NOT_DEALT };

        let card_config = CardConfig {
            range: [oop, ip],
            flop,
            turn,
            river,
        };

        let initial_state = match board_len {
            3 => BoardState::Flop,
            4 => BoardState::Turn,
            _ => BoardState::River,
        };

        let flop_bet_sizes = [
            BetSizeOptions::try_from((oop_flop_bet, oop_flop_raise))
                .map_err(|e| JsError::new(&e))?,
            BetSizeOptions::try_from((ip_flop_bet, ip_flop_raise))
                .map_err(|e| JsError::new(&e))?,
        ];
        let turn_bet_sizes = [
            BetSizeOptions::try_from((oop_turn_bet, oop_turn_raise))
                .map_err(|e| JsError::new(&e))?,
            BetSizeOptions::try_from((ip_turn_bet, ip_turn_raise))
                .map_err(|e| JsError::new(&e))?,
        ];
        let river_bet_sizes = [
            BetSizeOptions::try_from((oop_river_bet, oop_river_raise))
                .map_err(|e| JsError::new(&e))?,
            BetSizeOptions::try_from((ip_river_bet, ip_river_raise))
                .map_err(|e| JsError::new(&e))?,
        ];

        let tree_config = TreeConfig {
            initial_state,
            starting_pot,
            effective_stack,
            rake_rate,
            rake_cap,
            flop_bet_sizes,
            turn_bet_sizes,
            river_bet_sizes,
            turn_donk_sizes: None,
            river_donk_sizes: None,
            add_allin_threshold,
            force_allin_threshold,
            merging_threshold,
        };

        let action_tree = ActionTree::new(tree_config).map_err(|e| JsError::new(&e))?;
        self.game = PostFlopGame::with_config(card_config, action_tree)
            .map_err(|e| JsError::new(&e))?;
        Ok(())
    }

    pub fn memory_usage(&self, enable_compression: bool) -> Box<[u64]> {
        let (without, with) = self.game.memory_usage();
        if enable_compression {
            Box::new([with])
        } else {
            Box::new([without])
        }
    }

    pub fn allocate_memory(&mut self, enable_compression: bool) {
        self.game.allocate_memory(enable_compression);
    }

    pub fn solve_step(&self, current_iteration: u32) {
        solve_step(&self.game, current_iteration);
    }

    pub fn exploitability(&self) -> f32 {
        compute_exploitability(&self.game)
    }

    pub fn finalize(&mut self) {
        finalize(&mut self.game);
    }

    pub fn private_cards(&self, player: usize) -> Box<[u16]> {
        self.game
            .private_cards(player)
            .iter()
            .flat_map(|(c1, c2)| [*c1 as u16, *c2 as u16])
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn apply_history(&mut self, history: &[usize]) {
        self.game.back_to_root();
        for &action in history {
            self.game.play(action);
        }
    }

    pub fn current_player(&self) -> String {
        if self.game.is_chance_node() {
            "chance".to_string()
        } else {
            match self.game.current_player() {
                0 => "oop".to_string(),
                _ => "ip".to_string(),
            }
        }
    }

    pub fn is_terminal_node(&self) -> bool {
        self.game.is_terminal_node()
    }

    pub fn is_chance_node(&self) -> bool {
        self.game.is_chance_node()
    }

    pub fn num_actions(&self) -> usize {
        if self.game.is_terminal_node() || self.game.is_chance_node() {
            0
        } else {
            self.game.available_actions().len()
        }
    }

    pub fn actions(&self) -> String {
        if self.game.is_terminal_node() || self.game.is_chance_node() {
            return String::new();
        }
        self.game
            .available_actions()
            .iter()
            .map(|a| format!("{a:?}"))
            .collect::<Vec<_>>()
            .join(",")
    }

    pub fn strategy(&self) -> Box<[f32]> {
        self.game.strategy().to_vec().into_boxed_slice()
    }

    pub fn expected_values(&mut self, player: usize) -> Box<[f32]> {
        self.game.cache_normalized_weights();
        self.game.expected_values(player).to_vec().into_boxed_slice()
    }

    pub fn equity(&mut self, player: usize) -> Box<[f32]> {
        self.game.cache_normalized_weights();
        self.game.equity(player).to_vec().into_boxed_slice()
    }

    pub fn normalized_weights(&mut self, player: usize) -> Box<[f32]> {
        self.game.cache_normalized_weights();
        self.game
            .normalized_weights(player)
            .to_vec()
            .into_boxed_slice()
    }

    pub fn lock_current_strategy(&mut self, strategy: &[f32]) {
        self.game.lock_current_strategy(strategy);
    }

    pub fn unlock_current_node(&mut self) {
        self.game.unlock_current_strategy();
    }

    pub fn back_to_root(&mut self) {
        self.game.back_to_root();
    }

    pub fn play(&mut self, action: usize) {
        self.game.play(action);
    }

    pub fn current_board(&self) -> Box<[u8]> {
        self.game.current_board().into_boxed_slice()
    }

    pub fn possible_cards(&self) -> Box<[u8]> {
        let mask = self.game.possible_cards();
        (0u8..52)
            .filter(|&card| mask & (1u64 << card) != 0)
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn history(&self) -> Box<[u32]> {
        self.game
            .history()
            .iter()
            .map(|&action| action as u32)
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn total_bet_amount(&self) -> Box<[i32]> {
        self.game.total_bet_amount().to_vec().into_boxed_slice()
    }

    pub fn root_ev(&mut self, player: usize) -> f32 {
        self.game.cache_normalized_weights();
        let ev = self.game.expected_values(player);
        let w = self.game.normalized_weights(player);
        compute_average(&ev, w)
    }

    pub fn root_equity(&mut self, player: usize) -> f32 {
        self.game.cache_normalized_weights();
        let eq = self.game.equity(player);
        let w = self.game.normalized_weights(player);
        compute_average(&eq, w)
    }

    pub fn reset_traversal_stats(&self) {
        reset_traversal_stats();
    }

    pub fn traversal_stats(&self) -> Box<[u64]> {
        traversal_stats().to_vec().into_boxed_slice()
    }
}

#[wasm_bindgen(js_name = testRayon)]
pub fn test_rayon() -> Box<[f64]> {
    let num_threads = rayon::current_num_threads();
    let sum: u64 = (0u64..10_000_000).into_par_iter().map(|x| x % 7).sum();

    Box::new([
        num_threads as f64,
        sum as f64,
    ])
}
