import React from 'react';

type PropsType = {
  children: React.ReactNode;
};


export default ({ children }: PropsType): React.ReactElement => {
  // Toujours afficher le contenu web directement - pas de popup desktop
  return <>{children}</>;
};
