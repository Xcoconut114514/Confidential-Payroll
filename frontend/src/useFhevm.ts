/**
 * useFhevm.ts
 * Wraps the @zama-fhe/relayer-sdk browser SDK:
 *  - createInstance with SepoliaConfig
 *  - encryptUint64: encrypt a plaintext value for a contract call
 *  - userDecryptHandle: decrypt an euint64 handle returned by the contract
 */
import { useState, useCallback } from 'react'
import { ethers } from 'ethers'

// @zama-fhe/relayer-sdk web entry
import {
  createInstance,
  SepoliaConfig,
} from '@zama-fhe/relayer-sdk/web'
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web'

// Duration for EIP-712 user-decrypt permit (1 day)
const DECRYPT_DURATION_DAYS = 1

export function useFhevm() {
  const [instance, setInstance] = useState<FhevmInstance | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const init = useCallback(async (provider: ethers.BrowserProvider) => {
    if (instance) return instance
    setLoading(true)
    setError(null)
    try {
      const ethersProvider = provider as unknown as import('ethers').Eip1193Provider
      const fhevm = await createInstance({
        ...SepoliaConfig,
        network: ethersProvider,
      })
      setInstance(fhevm)
      return fhevm
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to init FHE SDK'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [instance])

  /**
   * Encrypt a uint64 value for use as calldata in a contract function.
   * Returns { handle: string, inputProof: string } ready for the contract ABI.
   */
  const encryptUint64 = useCallback(async (
    fhevm: FhevmInstance,
    value: bigint,
    contractAddress: string,
    userAddress: string,
  ): Promise<{ handle: string; inputProof: string }> => {
    const input = fhevm.createEncryptedInput(contractAddress, userAddress)
    input.add64(value)
    const { handles, inputProof } = await input.encrypt()

    // handles[0] is Uint8Array (bytes32), inputProof is Uint8Array (bytes)
    const handle = ethers.hexlify(handles[0])
    const proofHex = ethers.hexlify(inputProof)
    return { handle, inputProof: proofHex }
  }, [])

  /**
   * Decrypt a single euint64 handle using EIP-712 signed user-decrypt.
   * Returns the plaintext bigint value.
   */
  const userDecryptHandle = useCallback(async (
    fhevm: FhevmInstance,
    handle: string,             // bytes32 hex returned by viewMySalary() etc.
    contractAddress: string,
    signer: ethers.Signer,
  ): Promise<bigint> => {
    const userAddress = await signer.getAddress()

    // Generate ephemeral keypair for this session
    const { publicKey, privateKey } = fhevm.generateKeypair()

    // Timestamp for EIP-712 permit window
    const startTimestamp = Math.floor(Date.now() / 1000)

    // Build EIP-712 message
    const eip712 = fhevm.createEIP712(
      publicKey,
      [contractAddress],
      startTimestamp,
      DECRYPT_DURATION_DAYS,
    )

    // Ask user to sign (cast types to mutable for ethers compatibility)
    const signature = await signer.signTypedData(
      eip712.domain as Record<string, unknown>,
      eip712.types as unknown as Record<string, ethers.TypedDataField[]>,
      eip712.message as Record<string, unknown>,
    )

    // Call Zama KMS relayer to decrypt
    const results = await fhevm.userDecrypt(
      [{ handle, contractAddress }],
      privateKey,
      publicKey,
      signature,
      [contractAddress],
      userAddress,
      startTimestamp,
      DECRYPT_DURATION_DAYS,
    )

    // Results is a Record<`0x${string}`, bigint>
    const value = results[handle as `0x${string}`]
    if (value === undefined) {
      throw new Error('Decryption returned no value for handle')
    }
    return typeof value === 'bigint' ? value : BigInt(String(value))
  }, [])

  return { instance, init, encryptUint64, userDecryptHandle, loading, error }
}
