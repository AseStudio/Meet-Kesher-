import React from 'react';
import WhiteboardCanvas from '../../components/WhiteboardCanvas';

/**
 * Blackboard.js is now just WhiteboardCanvas themed as a blackboard.
 * The old duplicate drawing engine (its own PanResponder, its own
 * "paint background color" eraser, no persistence, no undo-by-ID, etc.)
 * is gone — this file exists only so any navigator route still pointing
 * at `Blackboard` keeps working as a standalone screen.
 *
 * If nothing in your navigator references 'Blackboard' anymore (i.e. you
 * only ever open it embedded via SessionMain's board picker), you can
 * delete this file and the route entirely.
 */
export default function Blackboard({ navigation, route }) {
  const { session, isHost, currentUser } = route.params || {};
  return (
    <WhiteboardCanvas
      session={session}
      currentUser={currentUser}
      isHost={isHost}
      canDraw={true}
      visible={true}
      mode="fullscreen"
      theme="blackboard"
      onRequestClose={() => navigation.goBack()}
    />
  );
}