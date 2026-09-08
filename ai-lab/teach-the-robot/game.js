const GRID_SIZE = 10;
const MAX_STEPS = 80;
const ROBOT_MOVE_DELAY = 500;
const THINKING_DELAY = 500;
const WALL_COUNT = 17;
const PLANNERS = {
  BFS: "bfs",
  DFS: "dfs",
  QLEARNING: "qlearning"
};

let selectedPlanner = PLANNERS.BFS;   // default

// Q-Learning hyper-parameters
const QL = {
  episodes: 1200,
  alpha: 0.25,
  gamma: 0.95,
  epsilonStart: 0.9,
  epsilonEnd: 0.05,
  epsilonDecay: 0.995,
  maxStepsPerEpisode: MAX_STEPS
};
const ACTIONS = {
  UP: { row: -1, col: 0, label: "Move up", symbol: "↑" },
  DOWN: { row: 1, col: 0, label: "Move down", symbol: "↓" },
  LEFT: { row: 0, col: -1, label: "Move left", symbol: "←" },
  RIGHT: { row: 0, col: 1, label: "Move right", symbol: "→" }
};

const elements = {
  board: document.getElementById("game-board"),
  title: document.getElementById("game-title"),
  status: document.getElementById("game-status"),
  steps: document.getElementById("steps-value"),
  reward: document.getElementById("reward-value"),
  package: document.getElementById("package-value"),
  instruction: document.getElementById("instruction-text"),
  reasoning: document.getElementById("reasoning-content"),
  robotBadge: document.getElementById("robot-mode-badge"),
  restart: document.getElementById("restart-button"),
  finishHuman: document.getElementById("finish-human-button"),
  movementButtons: [...document.querySelectorAll("[data-direction]")]
};
function createPlannerSelector() {
  if (document.getElementById("planner-select")) return;

  const container = document.createElement("div");
  container.style.cssText = "margin: 12px 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;";

  const label = document.createElement("label");
  label.textContent = "Robot Planner:";
  label.style.fontWeight = "600";

  const select = document.createElement("select");
  select.id = "planner-select";
  select.style.cssText = "padding: 6px 10px; border-radius: 6px; border: 1px solid #ccc; font-size: 14px;";

  [
    { value: PLANNERS.BFS, text: "BFS (shortest path)" },
    { value: PLANNERS.DFS, text: "DFS (any valid path)" },
    { value: PLANNERS.QLEARNING, text: "Q-Learning (RL)" }
  ].forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.text;
    select.appendChild(o);
  });

  select.value = selectedPlanner;
  select.addEventListener("change", (e) => {
    selectedPlanner = e.target.value;
  });

  container.appendChild(label);
  container.appendChild(select);

  // Insert it near the title / status area
  const target = elements.title?.parentElement || document.body;
  target.insertBefore(container, target.firstChild);
}
let map = null;
let game = null;
let timers = new Set();
let runId = 0;

function clonePosition(position) {
  return { row: position.row, col: position.col };
}

function keyOf(position) {
  return `${position.row},${position.col}`;
}

function positionsMatch(first, second) {
  return first.row === second.row && first.col === second.col;
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isInsideGrid(position) {
  return (
    position.row >= 0 &&
    position.row < GRID_SIZE &&
    position.col >= 0 &&
    position.col < GRID_SIZE
  );
}

function getManhattanDistance(first, second) {
  return Math.abs(first.row - second.row) + Math.abs(first.col - second.col);
}

function isWall(position) {
  return map.walls.some((wall) => positionsMatch(wall, position));
}

function getValidActions(position) {
  return Object.keys(ACTIONS).filter((action) => {
    const direction = ACTIONS[action];
    const candidate = {
      row: position.row + direction.row,
      col: position.col + direction.col
    };

    return isInsideGrid(candidate) && !isWall(candidate);
  });
}

/*
  Every scheduled timeout is stored here.
  Restart clears all pending robot decisions/moves, avoiding glitches.
*/
function schedule(callback, delay, activeRunId = runId) {
  const timerId = window.setTimeout(() => {
    timers.delete(timerId);

    if (activeRunId !== runId) {
      return;
    }

    callback();
  }, delay);

  timers.add(timerId);
  return timerId;
}

function clearAllTimers() {
  timers.forEach((timerId) => window.clearTimeout(timerId));
  timers.clear();
}

/*
  Breadth-first search finds the shortest valid path through the current map.
  It returns an array such as: ["UP", "UP", "RIGHT", "RIGHT"].
*/
function findShortestPath(start, target) {
  const queue = [{ position: clonePosition(start), path: [] }];
  const visited = new Set([keyOf(start)]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (positionsMatch(current.position, target)) {
      return current.path;
    }

    for (const action of Object.keys(ACTIONS)) {
      const direction = ACTIONS[action];
      const nextPosition = {
        row: current.position.row + direction.row,
        col: current.position.col + direction.col
      };

      const nextKey = keyOf(nextPosition);

      if (
        !isInsideGrid(nextPosition) ||
        isWall(nextPosition) ||
        visited.has(nextKey)
      ) {
        continue;
      }

      visited.add(nextKey);

      queue.push({
        position: nextPosition,
        path: [...current.path, action]
      });
    }
  }

  return null;
}
function findPathDFS(start, target) {
  const stack = [{ position: clonePosition(start), path: [] }];
  const visited = new Set([keyOf(start)]);

  while (stack.length > 0) {
    const current = stack.pop();

    if (positionsMatch(current.position, target)) {
      return current.path;
    }

    const actionKeys = Object.keys(ACTIONS).reverse();
    for (const action of actionKeys) {
      const direction = ACTIONS[action];
      const nextPosition = {
        row: current.position.row + direction.row,
        col: current.position.col + direction.col
      };
      const nextKey = keyOf(nextPosition);

      if (
        !isInsideGrid(nextPosition) ||
        isWall(nextPosition) ||
        visited.has(nextKey)
      ) {
        continue;
      }

      visited.add(nextKey);
      stack.push({
        position: nextPosition,
        path: [...current.path, action]
      });
    }
  }
  return null;
}
function stateKey(pos, hasPackage) {
  return `${pos.row},${pos.col},${hasPackage ? 1 : 0}`;
}

function createEmptyQ() {
  const q = {};
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      for (const has of [false, true]) {
        const key = stateKey({ row: r, col: c }, has);
        q[key] = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
      }
    }
  }
  return q;
}

function getBestAction(q, stateKey, validActions) {
  let best = validActions[0];
  let bestVal = -Infinity;
  for (const a of validActions) {
    const v = q[stateKey][a];
    if (v > bestVal) {
      bestVal = v;
      best = a;
    }
  }
  return best;
}

function stateKey(pos, hasPackage) {
  return `${pos.row},${pos.col},${hasPackage ? 1 : 0}`;
}

function createEmptyQ() {
  const q = {};
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      for (const has of [false, true]) {
        const key = stateKey({ row: r, col: c }, has);
        q[key] = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
      }
    }
  }
  return q;
}

function getBestAction(q, stateKey, validActions) {
  let best = validActions[0];
  let bestVal = -Infinity;
  for (const a of validActions) {
    const v = q[stateKey][a];
    if (v > bestVal) {
      bestVal = v;
      best = a;
    }
  }
  return best;
}

function extractGreedyPathFromQ(q) {
  const path = [];
  let pos = clonePosition(map.robotStart);
  let hasPackage = false;
  const visited = new Set();

  for (let i = 0; i < MAX_STEPS; i++) {
    const sKey = stateKey(pos, hasPackage);
    if (visited.has(sKey)) break;
    visited.add(sKey);

    const valid = getValidActions(pos);
    if (valid.length === 0) break;

    const action = getBestAction(q, sKey, valid);
    path.push(action);

    const dir = ACTIONS[action];
    pos = { row: pos.row + dir.row, col: pos.col + dir.col };

    if (!hasPackage && positionsMatch(pos, map.package)) {
      hasPackage = true;
    } else if (hasPackage && positionsMatch(pos, map.goal)) {
      break;
    }
  }
  return path;
}

function trainQLearningOnCurrentMap(onProgress) {
  const q = createEmptyQ();

  // ---------- Phase 1: Learn from Human ----------
  const REPLAY_TIMES = 30;
  if (game.humanTrajectory && game.humanTrajectory.length > 0) {
    for (let replay = 0; replay < REPLAY_TIMES; replay++) {
      if (onProgress) {
        onProgress({
          phase: "watching",
          current: replay + 1,
          total: REPLAY_TIMES,
          message: `Watching your moves… ${replay + 1}/${REPLAY_TIMES}`
        });
      }

      let pos = clonePosition(map.robotStart);
      let hasPackage = false;

      for (const step of game.humanTrajectory) {
        const sKey = stateKey(pos, hasPackage);
        const action = step.action;
        const reward = step.reward;

        if (!step.valid) {
          q[sKey][action] += QL.alpha * (reward - q[sKey][action]);
          continue;
        }

        const dir = ACTIONS[action];
        const nextPos = {
          row: pos.row + dir.row,
          col: pos.col + dir.col
        };

        let nextHas = hasPackage;
        if (!hasPackage && positionsMatch(nextPos, map.package)) nextHas = true;
        else if (hasPackage && positionsMatch(nextPos, map.goal)) nextHas = false;

        const nextKey = stateKey(nextPos, nextHas);
        const nextValid = getValidActions(nextPos);
        const maxNext = nextValid.length
          ? Math.max(...nextValid.map(a => q[nextKey][a]))
          : 0;

        q[sKey][action] += QL.alpha * (reward + QL.gamma * maxNext - q[sKey][action]);

        pos = nextPos;
        hasPackage = nextHas;
      }
    }
  }

  // ---------- Phase 2: Self-improvement ----------
  const IMPROVE_EPISODES = 180;
  let epsilon = 0.35;

  for (let ep = 0; ep < IMPROVE_EPISODES; ep++) {
    if (onProgress && ep % 10 === 0) {
      onProgress({
        phase: "practicing",
        current: ep + 1,
        total: IMPROVE_EPISODES,
        message: `Practicing by myself… ${ep + 1}/${IMPROVE_EPISODES}`
      });
    }

    let pos = clonePosition(map.robotStart);
    let hasPackage = false;
    let delivered = false;
    let steps = 0;

    while (steps < QL.maxStepsPerEpisode && !delivered) {
      const sKey = stateKey(pos, hasPackage);
      const valid = getValidActions(pos);
      if (valid.length === 0) break;

      let action = Math.random() < epsilon
        ? valid[randomInteger(0, valid.length - 1)]
        : getBestAction(q, sKey, valid);

      const dir = ACTIONS[action];
      const nextPos = { row: pos.row + dir.row, col: pos.col + dir.col };

      let reward = -0.1;
      let nextHas = hasPackage;
      let done = false;

      if (!isInsideGrid(nextPos) || isWall(nextPos)) {
        reward = -2;
      } else {
        pos = nextPos;
        if (!hasPackage && positionsMatch(pos, map.package)) {
          nextHas = true;
          reward += 10;
        } else if (hasPackage && positionsMatch(pos, map.goal)) {
          nextHas = false;
          delivered = true;
          reward += 100;
          done = true;
        }
      }

      const nextKey = stateKey(pos, nextHas);
      const nextValid = getValidActions(pos);
      const maxNext = nextValid.length
        ? Math.max(...nextValid.map(a => q[nextKey][a]))
        : 0;

      q[sKey][action] += QL.alpha * (reward + QL.gamma * maxNext - q[sKey][action]);

      hasPackage = nextHas;
      steps++;
      if (done) break;
    }
    epsilon = Math.max(0.05, epsilon * 0.991);
  }

  if (onProgress) {
    onProgress({
      phase: "done",
      message: "Learning complete! Starting to move…"
    });
  }

  return q;
}

function generateRandomMap() {
  const reservedCorners = [
    { row: 0, col: 0 },
    { row: 0, col: GRID_SIZE - 1 },
    { row: GRID_SIZE - 1, col: 0 },
    { row: GRID_SIZE - 1, col: GRID_SIZE - 1 }
  ];

  while (true) {
    const robotStart = clonePosition(
      reservedCorners[randomInteger(0, reservedCorners.length - 1)]
    );

    let packagePosition;
    let goalPosition;

    do {
      packagePosition = {
        row: randomInteger(0, GRID_SIZE - 1),
        col: randomInteger(0, GRID_SIZE - 1)
      };
    } while (positionsMatch(packagePosition, robotStart));

    do {
      goalPosition = {
        row: randomInteger(0, GRID_SIZE - 1),
        col: randomInteger(0, GRID_SIZE - 1)
      };
    } while (
      positionsMatch(goalPosition, robotStart) ||
      positionsMatch(goalPosition, packagePosition)
    );

    const protectedCells = new Set([
      keyOf(robotStart),
      keyOf(packagePosition),
      keyOf(goalPosition)
    ]);

    const walls = [];
    const wallKeys = new Set();

    while (walls.length < WALL_COUNT) {
      const wall = {
        row: randomInteger(0, GRID_SIZE - 1),
        col: randomInteger(0, GRID_SIZE - 1)
      };

      const wallKey = keyOf(wall);

      if (protectedCells.has(wallKey) || wallKeys.has(wallKey)) {
        continue;
      }

      walls.push(wall);
      wallKeys.add(wallKey);
    }

    const candidateMap = {
      robotStart,
      package: packagePosition,
      goal: goalPosition,
      walls
    };

    map = candidateMap;

    const toPackage = findShortestPath(robotStart, packagePosition);
    const toGoal = findShortestPath(packagePosition, goalPosition);

    if (toPackage && toGoal) {
      return candidateMap;
    }
  }
}

function resetGame() {
  runId += 1;
  clearAllTimers();

  map = generateRandomMap();

  game = {
    phase: "human",
    robotPosition: clonePosition(map.robotStart),
    hasPackage: false,
    packageDelivered: false,
    steps: 0,
    reward: 0,
    humanResult: null,
    robotResult: null,
    humanTrajectory: [],
    robotPath: [],
    message:
      "New warehouse created. Pick up the yellow package and deliver it to the green zone."
  };
  game.humanPathPositions = [];
  game.robotPathPositions = [];  

  render();
}

function getCellClasses(position) {
  const classes = ["cell"];

  if (isWall(position)) {
    classes.push("wall");
    return classes.join(" ");
  }

  // Show paths only when the experiment is finished
  if (game.phase === "complete") {
    const onHuman = game.humanPathPositions?.some(p => positionsMatch(p, position));
    const onRobot = game.robotPathPositions?.some(p => positionsMatch(p, position));

    if (onHuman && onRobot) {
      classes.push("both-paths");
    } else if (onHuman) {
      classes.push("human-path");
    } else if (onRobot) {
      classes.push("robot-path");
    }
  }

  if (positionsMatch(position, map.goal)) {
    classes.push("goal");
  }

  if (
    !game.hasPackage &&
    !game.packageDelivered &&
    positionsMatch(position, map.package)
  ) {
    classes.push("package");
  }

  if (positionsMatch(position, game.robotPosition)) {
    classes.push("robot");
    if (game.hasPackage) {
      classes.push("carrying");
    }
  }

  return classes.join(" ");
}

function renderBoard() {
  elements.board.innerHTML = "";

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const position = { row, col };
      const cell = document.createElement("div");

      cell.className = getCellClasses(position);
      cell.setAttribute("role", "gridcell");

      if (positionsMatch(position, game.robotPosition)) {
        cell.setAttribute(
          "aria-label",
          game.hasPackage
            ? "Robot carrying the package"
            : "Robot"
        );
      }

      elements.board.appendChild(cell);
    }
  }
}

function renderStats() {
  elements.steps.textContent = `${game.steps} / ${MAX_STEPS}`;
  elements.reward.textContent = game.reward.toFixed(1);

  if (game.packageDelivered) {
    elements.package.textContent = "Delivered";
    return;
  }

  elements.package.textContent = game.hasPackage
    ? "Carrying"
    : "Not picked up";
}

function setMovementControlsDisabled(disabled) {
  elements.movementButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function setStatus(text, color, background) {
  elements.status.textContent = text;
  elements.status.style.color = color;
  elements.status.style.background = background;
}

function renderStatus() {
  if (game.phase === "human") {
    elements.title.textContent = "Human Turn";
    setStatus("PLAYING", "#347a51", "#e6f3e9");
    elements.instruction.textContent = game.message;
    elements.finishHuman.disabled = false;
    elements.finishHuman.textContent = "Let Robot Try →";
    setMovementControlsDisabled(false);
    return;
  }

  if (game.phase === "human-finished") {
    elements.title.textContent = "Human Turn Complete";
    setStatus(
      game.humanResult.success ? "SUCCESS" : "COMPLETE",
      game.humanResult.success ? "#347a51" : "#8c5b00",
      game.humanResult.success ? "#e6f3e9" : "#fff2ce"
    );

    elements.instruction.textContent =
      game.humanResult.success
        ? `You delivered the package in ${game.humanResult.steps} steps. Let the robot plan a route through this same random warehouse.`
        : `Your run ended after ${game.humanResult.steps} steps. Let the robot try the same warehouse.`;

    elements.finishHuman.disabled = false;
    elements.finishHuman.textContent = "Let Robot Try →";
    setMovementControlsDisabled(true);
    return;
  }

  if (game.phase === "robot-thinking") {
    elements.title.textContent = "Robot Turn";
    setStatus("PLANNING", "#4778b8", "#eaf1fa");
    elements.instruction.textContent =
      "The robot is calculating a valid shortest route through the current warehouse.";
    elements.finishHuman.disabled = true;
    setMovementControlsDisabled(true);
    return;
  }

  if (game.phase === "robot-moving") {
    elements.title.textContent = "Robot Turn";
    setStatus("MOVING", "#4778b8", "#eaf1fa");
    elements.instruction.textContent =
      "The robot is following its planned route.";
    elements.finishHuman.disabled = true;
    setMovementControlsDisabled(true);
    return;
  }

  if (game.phase === "complete") {
    elements.title.textContent = "Experiment Complete";
    setStatus("DONE", "#347a51", "#e6f3e9");
    elements.instruction.textContent =
      "Click Restart to create a new random warehouse and play again.";
    elements.finishHuman.disabled = true;
    setMovementControlsDisabled(true);
  }
}

function renderReasoningEmpty() {
  elements.robotBadge.textContent = "WAITING";
  elements.robotBadge.style.color = "#787878";
  elements.robotBadge.style.background = "#f5f5f3";

  elements.reasoning.innerHTML = `
    <div class="reasoning-empty">
      <div class="robot-icon" aria-hidden="true">🤖</div>
      <h3>The robot is waiting.</h3>
      <p>
        Every restart creates a new reachable warehouse. When your turn ends,
        the robot will calculate a route and explain each chosen action.
      </p>
    </div>
  `;
}

function renderRobotReasoning(decision, remainingSeconds) {
  elements.robotBadge.textContent =
    game.phase === "robot-thinking" ? "PLANNING" : "MOVING";
  elements.robotBadge.style.color = "#2e609c";
  elements.robotBadge.style.background = "#eaf1fa";

  const actionRows = Object.entries(decision.actionValues)
    .map(([action, value]) => {
      const selectedClass = action === decision.selectedAction ? "selected" : "";

      return `
        <div class="action-row ${selectedClass}">
          <span>${ACTIONS[action].symbol} ${ACTIONS[action].label}</span>
          <span class="action-value">${value}</span>
        </div>
      `;
    })
    .join("");

  elements.reasoning.innerHTML = `
    <div class="reasoning-grid">
      <section class="reasoning-section">
        <h3>Current observation</h3>
        <ul>
          <li>Robot position: (${game.robotPosition.row + 1}, ${game.robotPosition.col + 1})</li>
          <li>Package: ${game.hasPackage ? "Carrying package" : "Not carrying package"}</li>
          <li>Target: ${game.hasPackage ? "Delivery zone" : "Package"}</li>
          <li>Remaining planned moves: ${decision.remainingMoves}</li>
        </ul>
      </section>

      <section class="reasoning-section">
        <h3>Route action scores</h3>
        <div class="action-list">${actionRows}</div>
      </section>

      <section class="reasoning-section">
        <h3>Decision</h3>
        <p class="decision-copy">${decision.explanation}</p>
      </section>

      <section class="countdown-box">
        <span class="countdown-label">ROBOT MOVES IN</span>
        <span class="countdown-value">${remainingSeconds.toFixed(1)}s</span>
      </section>
    </div>
  `;
}

function renderResults() {
  if (!game.humanResult || !game.robotResult) {
    return;
  }

  const methodName =
    selectedPlanner === PLANNERS.BFS
      ? "Breadth-First Search (BFS) – shortest path"
      : selectedPlanner === PLANNERS.DFS
      ? "Depth-First Search (DFS) – any valid path"
      : "Q-Learning (learned from your moves + self-practice)";

  const stepsDiff = game.humanResult.steps - game.robotResult.steps;
  const improvementText =
    selectedPlanner === PLANNERS.QLEARNING
      ? stepsDiff > 0
        ? `The robot improved your route by <strong>${stepsDiff}</strong> steps.`
        : stepsDiff < 0
        ? `The robot took <strong>${Math.abs(stepsDiff)}</strong> more steps than you.`
        : `The robot matched your step count.`
      : "";

  elements.reasoning.innerHTML = `
    <div class="reasoning-grid">
      <section class="reasoning-section">
        <h3>Human result</h3>
        <ul>
          <li>Outcome: ${game.humanResult.success ? "Package delivered" : "Not delivered"}</li>
          <li>Steps: ${game.humanResult.steps}</li>
          <li>Reward: ${game.humanResult.reward.toFixed(1)}</li>
        </ul>
      </section>

      <section class="reasoning-section">
        <h3>Robot result</h3>
        <ul>
          <li>Outcome: ${game.robotResult.success ? "Package delivered" : "Not delivered"}</li>
          <li>Steps: ${game.robotResult.steps}</li>
          <li>Reward: ${game.robotResult.reward.toFixed(1)}</li>
        </ul>
      </section>

      <section class="reasoning-section">
        <h3>Method used</h3>
        <p class="decision-copy">
          This run used <strong>${methodName}</strong>.
        </p>
        ${improvementText ? `<p class="decision-copy" style="margin-top:8px;">${improvementText}</p>` : ""}
      </section>

      <section class="reasoning-section">
        <h3>Path Comparison</h3>
        <div style="display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0; font-size: 14px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width:18px; height:18px; background:rgba(251, 191, 36, 0.55); border-radius:4px; border:1px solid #d97706;"></div>
            <span>Your path</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width:18px; height:18px; background:rgba(59, 130, 246, 0.50); border-radius:4px; border:1px solid #2563eb;"></div>
            <span>Robot path</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width:18px; height:18px; background:rgba(16, 185, 129, 0.65); border-radius:4px; border:1px solid #059669;"></div>
            <span>Both visited</span>
          </div>
        </div>
        <p style="font-size:13px; color:#666; margin-top:4px;">
          Yellow = places you walked &nbsp;•&nbsp; Blue = places the robot walked &nbsp;•&nbsp; Green = both of you visited
        </p>
      </section>
    </div>
  `;
}


function render() {
  renderBoard();
  renderStats();
  renderStatus();

  if (game.phase === "human") {
    renderReasoningEmpty();
  }

  if (game.phase === "complete") {
    renderResults();
  }
}

function finishHumanTurn(success) {
  game.humanResult = {
    success,
    steps: game.steps,
    reward: game.reward
  };

  game.phase = "human-finished";
  render();
}

function attemptHumanMove(action) {
  if (game.phase !== "human") {
    return;
  }

  if (game.steps >= MAX_STEPS) {
    game.message = "Maximum steps reached.";
    finishHumanTurn(false);
    return;
  }

  const direction = ACTIONS[action];
  const nextPosition = {
    row: game.robotPosition.row + direction.row,
    col: game.robotPosition.col + direction.col
  };

  game.steps += 1;

  if (!isInsideGrid(nextPosition) || isWall(nextPosition)) {
    game.reward -= 2;
    game.message = "Blocked move. Choose another direction.";

    game.humanTrajectory.push({
      action,
      reward: -2,
      valid: false
    });

    if (game.steps >= MAX_STEPS) {
      finishHumanTurn(false);
      return;
    }

    render();
    return;
  }

  // Successful move
  game.robotPosition = nextPosition;
  game.reward -= 0.1;

  // Record position for path comparison
  if (!game.humanPathPositions) game.humanPathPositions = [];
  game.humanPathPositions.push(clonePosition(game.robotPosition));

  game.humanTrajectory.push({
    action,
    reward: -0.1,
    valid: true,
    position: clonePosition(game.robotPosition)
  });

  if (!game.hasPackage && positionsMatch(game.robotPosition, map.package)) {
    game.hasPackage = true;
    game.reward += 10;
    game.message = "Package collected. Take it to the green delivery zone.";
  } else if (game.hasPackage && positionsMatch(game.robotPosition, map.goal)) {
    game.hasPackage = false;
    game.packageDelivered = true;
    game.reward += 100;
    game.message = "Package delivered successfully.";
    finishHumanTurn(true);
    return;
  } else {
    game.message = game.hasPackage
      ? "Carry the package to the green delivery zone."
      : "Find the yellow package.";
  }

  if (game.steps >= MAX_STEPS) {
    game.message = "Maximum steps reached.";
    finishHumanTurn(false);
    return;
  }

  render();
}

/*
  The robot gets the shortest currently-valid route:
  robot -> package -> goal.
*/
function buildRobotRoute() {
  if (selectedPlanner === PLANNERS.BFS) {
    const firstPart = findShortestPath(map.robotStart, map.package);
    const secondPart = findShortestPath(map.package, map.goal);
    if (!firstPart || !secondPart) return null;
    return [...firstPart, ...secondPart];
  }

  if (selectedPlanner === PLANNERS.DFS) {
    const firstPart = findPathDFS(map.robotStart, map.package);
    const secondPart = findPathDFS(map.package, map.goal);
    if (!firstPart || !secondPart) return null;
    return [...firstPart, ...secondPart];
  }

  // Q-Learning
  const q = trainQLearningOnCurrentMap();
  game.qTable = q;               // store for decision display
  return extractGreedyPathFromQ(q);
}

/*
  These scores are explainable UI scores based on the known shortest route.
  They are intentionally named “route scores”, not Q-values, because BFS is
  path planning rather than a learned reinforcement-learning policy.
*/


function createRobotDecision(nextAction) {
  const target = game.hasPackage ? map.goal : map.package;
  const validActions = getValidActions(game.robotPosition);
  const actionValues = {};

  if (selectedPlanner === PLANNERS.QLEARNING && game.qTable) {
    const sKey = stateKey(game.robotPosition, game.hasPackage);
    Object.keys(ACTIONS).forEach(action => {
      if (!validActions.includes(action)) {
        actionValues[action] = "blocked";
      } else {
        const val = game.qTable[sKey][action].toFixed(2);
        actionValues[action] = action === nextAction ? `best · Q=${val}` : `Q=${val}`;
      }
    });
  } else {
    // BFS / DFS
    const fullPathFromCurrent =
      selectedPlanner === PLANNERS.BFS
        ? findShortestPath(game.robotPosition, target)
        : findPathDFS(game.robotPosition, target);

    Object.keys(ACTIONS).forEach(action => {
      if (!validActions.includes(action)) {
        actionValues[action] = "blocked";
        return;
      }
      const direction = ACTIONS[action];
      const candidate = {
        row: game.robotPosition.row + direction.row,
        col: game.robotPosition.col + direction.col
      };
      const routeAfter =
        selectedPlanner === PLANNERS.BFS
          ? findShortestPath(candidate, target)
          : findPathDFS(candidate, target);

      if (!routeAfter) {
        actionValues[action] = "no route";
      } else {
        actionValues[action] =
          action === nextAction
            ? `best · ${routeAfter.length + 1} moves`
            : `${routeAfter.length + 1} moves`;
      }
    });
  }

  const targetName = game.hasPackage ? "delivery zone" : "package";
  let explanation;

  if (selectedPlanner === PLANNERS.QLEARNING) {
    explanation = `Q-Learning first learned from your trajectory (${game.humanTrajectory?.length || 0} steps), then improved the policy. It is now following the highest Q-value action toward the ${targetName}.`;
  } else if (selectedPlanner === PLANNERS.DFS) {
    explanation = `DFS selected ${ACTIONS[nextAction].label}. Depth-first search found a valid (but not necessarily shortest) route to the ${targetName}.`;
  } else {
    explanation = `${ACTIONS[nextAction].label} begins the shortest valid route to the ${targetName} (BFS).`;
  }

  const remaining =
    selectedPlanner === PLANNERS.QLEARNING
      ? "—"
      : (selectedPlanner === PLANNERS.BFS
          ? findShortestPath(game.robotPosition, target)
          : findPathDFS(game.robotPosition, target))?.length ?? 0;

  return {
    selectedAction: nextAction,
    actionValues,
    remainingMoves: remaining,
    explanation
  };
}


function applyRobotMove(action) {
  const direction = ACTIONS[action];

  game.robotPosition = {
    row: game.robotPosition.row + direction.row,
    col: game.robotPosition.col + direction.col
  };

  game.steps += 1;
  game.reward -= 0.1;

  // Record position for path comparison
  if (!game.robotPathPositions) game.robotPathPositions = [];
  game.robotPathPositions.push(clonePosition(game.robotPosition));

  if (!game.hasPackage && positionsMatch(game.robotPosition, map.package)) {
    game.hasPackage = true;
    game.reward += 10;
  }

  if (game.hasPackage && positionsMatch(game.robotPosition, map.goal)) {
    game.hasPackage = false;
    game.packageDelivered = true;
    game.reward += 100;
  }
}

function finishRobotTurn() {
  game.robotResult = {
    success: game.packageDelivered,
    steps: game.steps,
    reward: game.reward
  };

  game.phase = "complete";
  render();
}

function runRobotStep() {
  if (game.packageDelivered || game.steps >= MAX_STEPS || game.robotPath.length === 0) {
    finishRobotTurn();
    return;
  }

  const nextAction = game.robotPath.shift();
  const decision = createRobotDecision(nextAction);

  game.phase = "robot-thinking";
  render();
  renderRobotReasoning(decision, THINKING_DELAY / 1000);

  schedule(() => {
    game.phase = "robot-moving";
    applyRobotMove(nextAction);
    render();
    renderRobotReasoning(decision, 0);

    schedule(() => {
      if (game.packageDelivered || game.steps >= MAX_STEPS) {
        finishRobotTurn();
        return;
      }

      runRobotStep();
    }, ROBOT_MOVE_DELAY);
  }, THINKING_DELAY);
}

function startRobotTurn() {
  if (game.phase !== "human-finished") return;

  clearAllTimers();
  runId += 1;

  // Show learning UI immediately
  game.phase = "robot-thinking";
  elements.title.textContent = "Robot is Learning";
  setStatus("LEARNING", "#7c3aed", "#f3e8ff");
  elements.instruction.textContent = "The robot is studying your moves…";
  elements.finishHuman.disabled = true;
  setMovementControlsDisabled(true);

  elements.reasoning.innerHTML = `
    <div class="reasoning-empty">
      <div class="robot-icon">🧠</div>
      <h3 id="learning-title">Preparing to learn…</h3>
      <p id="learning-message">Please wait</p>
      <div style="margin-top:16px; background:#e5e7eb; border-radius:999px; height:10px; overflow:hidden;">
        <div id="learning-bar" style="height:100%; width:0%; background:#7c3aed; transition: width 0.2s;"></div>
      </div>
    </div>
  `;

  // Small delay so the UI can paint
  schedule(() => {
    const robotRoute = buildRobotRouteWithProgress();

    if (!robotRoute || robotRoute.length === 0) {
      game.message = "Robot could not find a path.";
      game.phase = "complete";
      render();
      return;
    }

    game.robotPosition = clonePosition(map.robotStart);
    game.hasPackage = false;
    game.packageDelivered = false;
    game.steps = 0;
    game.reward = 0;
    game.robotPath = [...robotRoute];
    game.robotPathPositions = []; // for path comparison

    runRobotStep();
  }, 100);
}

function buildRobotRouteWithProgress() {
  if (selectedPlanner === PLANNERS.BFS) {
    const first = findShortestPath(map.robotStart, map.package);
    const second = findShortestPath(map.package, map.goal);
    return first && second ? [...first, ...second] : null;
  }

  if (selectedPlanner === PLANNERS.DFS) {
    const first = findPathDFS(map.robotStart, map.package);
    const second = findPathDFS(map.package, map.goal);
    return first && second ? [...first, ...second] : null;
  }

  // Q-Learning with live progress
  const q = trainQLearningOnCurrentMap((info) => {
    const title = document.getElementById("learning-title");
    const msg = document.getElementById("learning-message");
    const bar = document.getElementById("learning-bar");

    if (title) title.textContent = info.phase === "watching" ? "Watching your moves" : 
                                   info.phase === "practicing" ? "Practicing alone" : "Ready!";
    if (msg) msg.textContent = info.message;
    if (bar && info.total) {
      bar.style.width = `${(info.current / info.total) * 100}%`;
    }
  });

  game.qTable = q;
  return extractGreedyPathFromQ(q);
}

function handleKeyboardMove(event) {
  const keyToAction = {
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT"
  };

  const action = keyToAction[event.key];

  if (!action) {
    return;
  }

  event.preventDefault();
  attemptHumanMove(action);
}

elements.movementButtons.forEach((button) => {
  button.addEventListener("click", () => {
    attemptHumanMove(button.dataset.direction);
  });
});

elements.restart.addEventListener("click", resetGame);
elements.finishHuman.addEventListener("click", startRobotTurn);
window.addEventListener("keydown", handleKeyboardMove);

resetGame();

elements.restart.addEventListener("click", resetGame);
elements.finishHuman.addEventListener("click", startRobotTurn);
window.addEventListener("keydown", handleKeyboardMove);

resetGame();
createPlannerSelector();
 // ← add this line