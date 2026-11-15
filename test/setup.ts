import { Logger } from '@nestjs/common';
// silencia logs nos testes (defina TEST_LOGS=1 para ver)
if (!process.env.TEST_LOGS) Logger.overrideLogger(false);
