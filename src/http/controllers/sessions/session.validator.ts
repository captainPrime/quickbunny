import { Matches, IsEmail, IsOptional } from 'class-validator';
import {
  PHONE_NUMBER_REGEX,
  PHONE_NUMBER_REGEX_ERROR,
} from '../../../internal/constants';

export class CreateSessionDTO {
  @IsOptional()
  first_name?: string;

  @IsOptional()
  last_name?: string;

  @IsOptional()
  @IsEmail()
  email_address?: string;

  @IsOptional()
  @Matches(PHONE_NUMBER_REGEX, { message: PHONE_NUMBER_REGEX_ERROR })
  phone_number?: string;
}
