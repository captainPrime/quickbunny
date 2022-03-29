import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  TransactionRepo,
  TRANSACTION_INTENTS,
  TransactionDTO,
  TRANSACTION_TYPES,
  TRANSACTION_PROVIDERS,
  TRANSACTION_STATUS,
  TransactionNotFound,
} from '@app/transactions';
import { FundWalletDTO } from './transaction.validator';
import { AuthGuard } from '@app/http/middlewares';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  InvalidSignature,
  PaystackService,
  PAYSTACK_EVENTS,
} from '@app/internal/paystack';
import { UnauthorizedRequest } from '@app/internal/errors';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UPDATE_WALLET_BALANCE } from '@app/internal/events';

@ApiTags('Transactions')
 @ApiBearerAuth('access-token')
@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly transactionRepo: TransactionRepo,
    private readonly paystack: PaystackService,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Initializes a wallet funding process
   */
  @UseGuards(AuthGuard)
  @Post('wallet-funding')
  async initialize_wallet_funding(
    @Body() body: FundWalletDTO,
    @Req() req: Request,
  ) {
    const amount = body.amount;
    const user_in_session = req.user;
    const intent = TRANSACTION_INTENTS.WALLET_FUNDING;
    const metadata = {
      user_id: user_in_session.id,
      intent,
    };

    const { data } = await this.paystack.initialize_transaction(
      amount,
      JSON.stringify(metadata),
    );
    const { authorization_url, reference } = data;

    // create a new transaction
    const transactionDTO: TransactionDTO = {
      amount,
      intent,
      transaction_type: TRANSACTION_TYPES.CREDIT,
      user: user_in_session,
      provider: TRANSACTION_PROVIDERS.PAYSTACK,
      transaction_reference: reference,
    };
    const { id } = await this.transactionRepo.create_transaction(
      transactionDTO,
    );

    return { payment_url: authorization_url, transaction_id: id };
  }

  @Post('paystack-webhook')
  async update_transaction(@Req() req: Request) {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      const dto = this.paystack.verify_hash(signature, req.body);

      const transaction =
        await this.transactionRepo.find_transaction_by_reference(
          dto.data.reference,
        );
      if (!transaction) return;

      transaction.raw = JSON.stringify(dto);

      switch (dto.event) {
        case PAYSTACK_EVENTS.CHARGE_SUCCESS:
          transaction.status = TRANSACTION_STATUS.SUCCESSFUL;
          transaction.amount_paid = Number(dto.data.amount) / 100;
          transaction.native_amount =
            transaction.transaction_type == TRANSACTION_TYPES.CREDIT
              ? transaction.amount_paid
              : transaction.amount_paid * -1;
          break;

        default:
          break;
      }
      await this.transactionRepo.save(transaction);
      this.emitter.emit(UPDATE_WALLET_BALANCE, transaction.user);
      return 'ok';
    } catch (err) {
      if (err instanceof InvalidSignature) {
        throw new UnauthorizedRequest(
          'sorry we could not verify the source of this request',
        );
      }

      throw err;
    }
  }

  @Get('/:transaction_id')
  async get_transaction(
    @Param('transaction_id', new ParseUUIDPipe()) transaction_id: string,
  ) {
    try {
      const transaction = await this.transactionRepo.findOne(transaction_id);
      if (!transaction) throw new TransactionNotFound();
      return transaction;
    } catch (err) {
      if (err instanceof TransactionNotFound) {
        throw new BadRequestException(err.message);
      }
    }
  }
}
