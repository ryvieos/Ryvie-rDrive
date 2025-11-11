import path from 'path';
import express from 'express';
import cors from 'cors';
import { renderFile } from 'eta';
import cookieParser from 'cookie-parser';

import { NODE_ENV, SERVER_BIND, SERVER_PORT } from '@config';
import logger from './lib/logger';
import errorMiddleware from './middlewares/error.middleware';
import { mountRoutes } from './routes';

import forgottenProcessorService from './services/forgotten-processor.service';

class App {
  public app: express.Application;
  public env: string;
  public port: string | number;

  constructor() {
    this.app = express();
    this.env = NODE_ENV;

    this.initViews();
    this.initMiddlewares();
    this.initRoutes();
    this.initErrorHandling();

    forgottenProcessorService.makeSureItsLoaded();
  }

  public listen = () => {
    const binding_host = SERVER_BIND || '0.0.0.0';
    this.app.listen(parseInt(SERVER_PORT, 10), binding_host, () => {
      logger.info(`🚀 App listening at http://${binding_host}:${SERVER_PORT}`);
    });
  };

  public getServer = () => this.app;

  private initRoutes = () => {
    this.app.use((req, res, next) => {
      logger.info(`Received request: ${req.method} ${req.originalUrl} from ${req.header('user-agent')} (${req.ip})`);
      next();
    });

    mountRoutes(this.app);
  };

  private initMiddlewares = () => {
    // Gérer les requêtes preflight pour Private Network Access (Chrome)
    this.app.use((req, res, next) => {
      // Vérifier si c'est une requête preflight pour accès réseau privé
      const requestPrivateNetwork = req.headers['access-control-request-private-network'];
      
      if (requestPrivateNetwork) {
        logger.info(`Private Network Access preflight détecté depuis ${req.headers.origin}`);
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      
      next();
    });
    
    this.app.use(cors({
      credentials: true,
      origin: true, // Autoriser toutes les origines
      preflightContinue: false,
      optionsSuccessStatus: 204
    }));
    
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  };

  private initViews = () => {
    this.app.engine('eta', renderFile);
    this.app.set('view engine', 'eta');
    this.app.set('views', path.join(__dirname, 'views'));
  };

  private initErrorHandling = () => {
    this.app.use(errorMiddleware);
  };
}

export default App;
