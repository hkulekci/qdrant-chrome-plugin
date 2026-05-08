// Import all rule files to register them
import './cluster-rules';
import './collection-rules';
import './segment-rules';
import './multi-tenancy-rules';

// Re-export engine functions
export { runRules, insightsForCollection } from './rule-engine';
