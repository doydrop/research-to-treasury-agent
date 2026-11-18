// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SwapHelper — minimal one-hop exact-input swapper for a KNOWN V3 pool.
/// @notice Built because the SwapRouter02 listed for Base Sepolia reverts on
/// every pool we tried (our seeded USDC/AAPLc pool and a liquid WETH/USDC
/// pool — quoter + position manager work fine, the router doesn't). The
/// router computes pool addresses itself, so a mismatch in its build breaks
/// every swap through it. This helper calls the pool directly with the pool
/// address given by the caller, so it never computes a pool address.
/// Testnet demo only; swaps are owner-only (the agent wallet).
interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);

    function token0() external view returns (address);

    function token1() external view returns (address);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SwapHelper {
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    /// @notice Swap an exact amount of tokenIn for tokenOut on a known pool.
    /// @dev The caller must approve this contract for tokenIn first.
    /// The output goes straight to `recipient` (the agent wallet).
    function swapExactInputSingle(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient
    ) external returns (uint256 amountOut) {
        require(msg.sender == owner, "SwapHelper: not owner");
        bool zeroForOne = tokenIn < tokenOut;
        uint160 sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1;
        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96,
            abi.encode(msg.sender)
        );
        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        require(amountOut >= amountOutMinimum, "SwapHelper: too little received");
    }

    /// @notice V3 swap callback: pull the input tokens from the payer into the pool.
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        address payer = abi.decode(data, (address));
        address token0 = IUniswapV3Pool(msg.sender).token0();
        address token1 = IUniswapV3Pool(msg.sender).token1();
        if (amount0Delta > 0) {
            IERC20(token0).transferFrom(payer, msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(token1).transferFrom(payer, msg.sender, uint256(amount1Delta));
        }
    }
}
