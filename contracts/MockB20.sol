// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockB20 — Sepolia testnet stand-in for a Coinbase B20 tokenized stock.
/// @notice NOT a real stock token: no backing, no issuer, no NAV. For the
/// Stocks Maxxing demo only — lets the treasury sweep execute against a real
/// ERC20 on Base Sepolia. Permissionless mint is intentional on testnet.
contract MockB20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 initialSupply, address to) {
        name = _name;
        symbol = _symbol;
        _mint(to, initialSupply);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "MockB20: insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "MockB20: insufficient balance");
        require(allowance[from][msg.sender] >= value, "MockB20: insufficient allowance");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}
