/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import {getPayer, getRpcUrl, createKeypairFromFile} from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Invoker's program id
 */
let invokerId: PublicKey;
let invokerId1: PublicKey;

let helloId: PublicKey;

/**
 * The public key of the account we are saying hello to
 */
let greetedPubkey: PublicKey;

let pdaPubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const HELLO_SO_PATH = path.join(PROGRAM_PATH, 'helloworld.so');
const INVOKER_SO_PATH = path.join(PROGRAM_PATH, 'invoker.so');
const INVOKER1_SO_PATH = path.join(PROGRAM_PATH, 'invoker1.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/helloworld.so`
 */
const HELLO_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'helloworld-keypair.json');
const INVOKER_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'invoker-keypair.json');
const INVOKER1_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'invoker1-keypair.json');

/**
 * The state of a greeting account managed by the hello world program
 */
class GreetingAccount {
  counter = 0;
  constructor(fields: {counter: number} | undefined = undefined) {
    if (fields) {
      this.counter = fields.counter;
    }
  }
}

/**
 * Borsh schema definition for greeting accounts
 */
const GreetingSchema = new Map([
  [GreetingAccount, {kind: 'struct', fields: [['counter', 'u32']]}],
]);

/**
 * The expected size of each greeting account.
 */
const GREETING_SIZE = borsh.serialize(
  GreetingSchema,
  new GreetingAccount(),
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(GREETING_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the invoker BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    console.log("INVOKER_KEYPAIR_PATH", INVOKER_KEYPAIR_PATH);
    const invokerKeyPair = await createKeypairFromFile(INVOKER_KEYPAIR_PATH);
    invokerId = invokerKeyPair.publicKey;

    const helloKeyPair = await createKeypairFromFile(HELLO_KEYPAIR_PATH);
    helloId = helloKeyPair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read invoker keypair at '${INVOKER_KEYPAIR_PATH}' due to error: ${errMsg}. Invoker may need to be deployed with \`solana program deploy dist/program/invoker.so\``,
    );
  }

  // Check if the invoker has been deployed
  const invokerInfo = await connection.getAccountInfo(invokerId);
  if (invokerInfo === null) {
    if (fs.existsSync(INVOKER_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/invoker.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!invokerInfo.executable) {
    throw new Error(`Invoker is not executable`);
  }
  console.log(`Using program ${invokerId.toBase58()}`);

  // Derive the address (public key) of a greeting account from the hello program so that it's easy to find later.
  const GREETING_SEED = 'hello';
  greetedPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    GREETING_SEED,
    helloId,
  );

  // Check if the greeting account has already been created
  const greetedAccount = await connection.getAccountInfo(greetedPubkey);
  if (greetedAccount === null) {
    console.log(
      'Creating account',
      greetedPubkey.toBase58(),
      'to say hello to',
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      GREETING_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: GREETING_SEED,
        newAccountPubkey: greetedPubkey,
        lamports,
        space: GREETING_SIZE,
        programId: helloId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }

  // PDA
  console.log("invokerId", invokerId.toBase58());
  pdaPubkey = await PublicKey.createProgramAddress(
    [Buffer.from('hello')],
    invokerId,
  );
  console.log("pdaPubkey", pdaPubkey.toBase58());
}

/**
 * Check if the invoker BPF program has been deployed
 */
 export async function checkProgram1(): Promise<void> {
  // Read program id from keypair file
  try {
    const invokerKeyPair = await createKeypairFromFile(INVOKER_KEYPAIR_PATH);
    const invokerKeyPair1 = await createKeypairFromFile(INVOKER1_KEYPAIR_PATH);
    invokerId = invokerKeyPair.publicKey;
    invokerId1 = invokerKeyPair1.publicKey;

    const helloKeyPair = await createKeypairFromFile(HELLO_KEYPAIR_PATH);
    helloId = helloKeyPair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read invoker keypair at '${INVOKER1_KEYPAIR_PATH}' due to error: ${errMsg}. Invoker may need to be deployed with \`solana program deploy dist/program/invoker.so\``,
    );
  }

  // Check if the invoker has been deployed
  const invokerInfo = await connection.getAccountInfo(invokerId1);
  if (invokerInfo === null) {
    if (fs.existsSync(INVOKER1_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/invoker.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!invokerInfo.executable) {
    throw new Error(`Invoker is not executable`);
  }
  console.log(`Using program Invoker1=${invokerId1.toBase58()}`);
  console.log(`Using program Invoker=${invokerId.toBase58()}`);

  // PDA Test
  greetedPubkey = await PublicKey.createProgramAddress(
    [Buffer.from('hello002')],
    invokerId,
  );
  console.log("invokerId1", invokerId1.toBase58());
  console.log("greetedPubkey", greetedPubkey.toBase58());
}

/**
 * Say hello
 */
export async function sayHello(): Promise<void> {
  console.log('Saying hello to', invokerId.toBase58());
  const instruction = new TransactionInstruction({
    keys: [{pubkey: helloId, isSigner: false, isWritable: false},
      {pubkey: greetedPubkey, isSigner: false, isWritable: true},
      {pubkey: pdaPubkey, isSigner: false, isWritable: false },
    ],
    programId: invokerId,
    data: Buffer.alloc(0), // All instructions are hellos
  });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
}

export async function sayHello1(): Promise<void> {
  console.log('Saying hello to', invokerId1.toBase58());
  const instruction = new TransactionInstruction({
    keys: [{pubkey: helloId, isSigner: false, isWritable: false},
      {pubkey: greetedPubkey, isSigner: false, isWritable: true}],
    programId: helloId,
    data: Buffer.alloc(0), // All instructions are hellos
  });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
}

/**
 * Report the number of times the greeted account has been said hello to
 */
export async function reportGreetings(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(greetedPubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }
  const greeting = borsh.deserialize(
    GreetingSchema,
    GreetingAccount,
    accountInfo.data,
  );
  console.log(
    greetedPubkey.toBase58(),
    'has been greeted',
    greeting.counter,
    'time(s)',
  );
}
