export const getHost = (subdomain?: string) => {
    const host =
      process.env.NODE_ENV === 'development'
        ? 'localhost:3000'
        : process.env.NEXT_PUBLIC_APP_HOSTNAME;
    return subdomain ? `${subdomain}.${host}` : host;
  };