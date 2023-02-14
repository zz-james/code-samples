/**
* on further.pi-top.com a challenge can have 3 visibility states, private is only viewable by the author, 
* shared is viewable by anyone with a link and public appears on the home page. Sometimes a challenge is included 
* in a course which has its own visibility settings, this gives the challenge an inherited visibilty and the 
* final visibility value is determined by the visibility priority.
* this simple utility exports a function that you can send the visibility and the inherited visibility to and it will
* return the highest priority state. It is done this way rather than hardcoded so that new visibility states can be 
* addded easily to the visibilityPriority array and the function will still work without changes
*/


import { VISIBILITY_STATES } from '../types/graphql-types';

export const visibilityPriority: Array<VISIBILITY_STATES> = [
  VISIBILITY_STATES.public,
  VISIBILITY_STATES.unlisted,
  VISIBILITY_STATES.private,
];

export default (
  visibility: VISIBILITY_STATES,
  inheritedVisibility?: VISIBILITY_STATES
) =>
  inheritedVisibility
    ? visibilityPriority[
        Math.min(
          visibilityPriority.indexOf(visibility),
          visibilityPriority.indexOf(inheritedVisibility)
        )
      ]
    : visibility;
