import { handleRequest } from '../../backend/app';

export default () => handleRequest(new Request('http://localhost/api/health'));
