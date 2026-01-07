export const formatBytes = (bytes: number, decimals = 2) => {
  // Cas spécial: valeur négative (-1) indique une taille approximative (> 5Go)
  if (bytes === -1) {
    return '> 5 Go';
  }
  
  // Si le backend a fourni un display_size, l'utiliser directement
  if (typeof bytes === 'object' && (bytes as any).display_size) {
    return (bytes as any).display_size;
  }
  
  if (!+bytes) return '0 Ko';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  // Utiliser uniquement Ko, Mo, Go (pas d'octets)
  const sizes = ['Ko', 'Ko', 'Mo', 'Go', 'To', 'Po', 'Eo', 'Zo', 'Yo'];

  let i = Math.floor(Math.log(bytes) / Math.log(k));
  
  // Forcer minimum à Ko (index 1)
  if (i === 0) {
    i = 1;
    return `${parseFloat((bytes / k).toFixed(dm))} Ko`;
  }

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const formatBytesToInt = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Ko';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  // Utiliser uniquement Ko, Mo, Go (pas d'octets)
  const sizes = ['Ko', 'Ko', 'Mo', 'Go', 'To', 'Po', 'Eo', 'Zo', 'Yo'];

  let i = Math.floor(Math.log(bytes) / Math.log(k));
  
  // Forcer minimum à Ko (index 1)
  if (i === 0) {
    i = 1;
    return `${parseInt((bytes / k).toFixed(dm))} Ko`;
  }

  return `${parseInt((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};
