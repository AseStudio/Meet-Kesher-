import React from 'react';
import WhiteboardCanvas from '../../components/WhiteboardCanvas';

/**
 * Standalone-screen wrapper, kept only for backward compatibility with
 * any navigator route still pointing at 'Whiteboard'. If you only ever
 * open the whiteboard embedded via SessionMain's board picker now, you
 * can delete this file and that route.
 */
export default function Whiteboard({ navigation, route }) {
  const { session, isHost, currentUser } = route.params || {};
  return (
    <WhiteboardCanvas
      session={session}
      currentUser={currentUser}
      isHost={isHost}
      canDraw={true}
      visible={true}
      mode="fullscreen"
      theme="whiteboard"
      onRequestClose={() => navigation.goBack()}
    />
  );
}