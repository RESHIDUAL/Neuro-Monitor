// Guided test protocol (decision recorded 24 Nov 2026).
// Core activities mirror the five PADS training tasks and are the only ones used for the main result.
// Contextual activities are not represented in the training data and are never mixed into the core result.

export type Section = 'core' | 'contextual';

export type Activity = {
  id: string;
  name: string;
  section: Section;
  seconds: number;
  instruction: string;
};

export const CONTEXTUAL_LABEL =
  'Activity not represented in model training data. Recorded for contextual monitoring only. Predictions are not validated for this activity.';

// Each core activity maps to one of the five PADS tasks the Track 1 model was trained on
// (Eshwar's notebooks: Relaxed, RelaxedTask, StretchHold, LiftHold, HoldWeight).
export const CORE_ACTIVITIES: Activity[] = [
  { id: 'rest_lap', name: 'Rest on lap', section: 'core', seconds: 30,
    instruction: 'Sit comfortably with your eyes closed. Rest the forearm with the band on your lap, hand relaxed. Stay still.' },
  { id: 'rest_arith', name: 'Rest with mental arithmetic', section: 'core', seconds: 30,
    instruction: 'Keep the arm resting on your lap. Count backwards from 100 in steps of 7, silently or aloud.' },
  { id: 'arms_out', name: 'Lift and stretch arms', section: 'core', seconds: 30,
    instruction: 'Lift both arms and stretch them straight out in front of you at shoulder height, palms facing down.' },
  { id: 'arms_lifted', name: 'Keep arms lifted', section: 'core', seconds: 30,
    instruction: 'Keep both arms lifted in front of you at shoulder height. Hold the position without moving.' },
  { id: 'hold_weight', name: 'Hold a weight', section: 'core', seconds: 30,
    instruction: 'Hold a weight of about 1 kg (for example a 1 litre water bottle) in the band hand, arm out in front of you.' },
];

export const CONTEXTUAL_ACTIVITIES: Activity[] = [
  { id: 'finger_nose', name: 'Finger-to-nose', section: 'contextual', seconds: 30,
    instruction: 'With the band arm, touch your nose with your index finger, then stretch the arm out. Repeat at a comfortable pace.' },
  { id: 'drinking', name: 'Drinking', section: 'contextual', seconds: 30,
    instruction: 'Lift a cup to your mouth, pretend to drink, and put it down. Repeat.' },
  { id: 'writing', name: 'Writing', section: 'contextual', seconds: 30,
    instruction: 'Write a short sentence on paper with the band hand. Repeat.' },
  { id: 'walking', name: 'Walking', section: 'contextual', seconds: 30,
    instruction: 'Walk at a normal pace with arms swinging naturally.' },
];

// From the master documentation, Step 1 (transient trimming): first 2 s of each task removed.
export const TRIM_SAMPLES = 200;
export const WINDOW_SAMPLES = 300; // 3 s, non-overlapping (training stride 300)
