import React from 'react';
import GraphBoardCanvas from '../../components/GraphboardCanvas';

/**
 * Standalone-screen wrapper, kept only for backward compatibility with
 * any navigator route still pointing at 'GraphBoard'. SessionMain now
 * renders GraphBoardCanvas embedded instead of navigating here.
 */
export default function GraphBoard({ navigation, route }) {
  const { session, isHost, currentUser } = route.params || {};
  return (
    <GraphBoardCanvas
      session={session}
      currentUser={currentUser}
      isHost={isHost}
      canEdit={true}
      visible={true}
      mode="fullscreen"
      onRequestClose={() => navigation.goBack()}
    />
  );
}