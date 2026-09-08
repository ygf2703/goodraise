import { handleRequest } from '../../backend/app';

export default (request: Request) => {
  const url = new URL(request.url);
  url.pathname = "/api/public-context";
  return handleRequest(new Request(url, { headers: request.headers }));
};
