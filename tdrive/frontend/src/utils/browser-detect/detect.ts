// Detection neutralisée: on n'essaie plus d'ouvrir un protocole personnalisé
// import customProtocolCheck from 'custom-protocol-check';

/**
 * checks if the tdrive app is installed in the system using the browser
 *
 * @returns {boolean} true if the tdrive app is installed
 */
export const detect = async (_path: string): Promise<boolean> => {
  // Toujours indiquer que l'app desktop n'est pas détectée pour éviter tout popup
  return false;
};
