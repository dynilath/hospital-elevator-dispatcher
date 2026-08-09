import { useState } from 'react';
import MainMenu from './ui/MainMenu';
import GameScreen from './ui/GameScreen';
import type { Difficulty } from './types';

export default function App() {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [gameKey, setGameKey] = useState(0);

  if (!difficulty) {
    return <MainMenu onStart={setDifficulty} />;
  }

  return (
    <GameScreen
      key={gameKey}
      difficulty={difficulty}
      onExit={() => {
        setDifficulty(null);
        setGameKey(0);
      }}
      onRestart={() => setGameKey((k) => k + 1)}
    />
  );
}
