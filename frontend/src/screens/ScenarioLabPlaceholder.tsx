import React from 'react';
import { ScenarioLab } from './ScenarioLab';

// Backward-compatible re-export preserving original screen registration
export { ScenarioLab };
export const ScenarioLabPlaceholder: React.FC = () => {
  return <ScenarioLab />;
};
export default ScenarioLab;
