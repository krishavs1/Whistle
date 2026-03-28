// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArbiToken (ARBI)
 * @notice TRC20-compatible incentive token for Whistle arbitrators
 * @dev Arbitrators stake ARBI to join the pool and earn rewards for correct votes.
 *      Minting authority is granted to the ArbitratorPool contract.
 */
contract ArbiToken {
    string public constant name = "Whistle Token";
    string public constant symbol = "ARBI";
    uint8  public constant decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    mapping(address => bool) public minters;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterUpdated(address indexed minter, bool authorized);

    modifier onlyOwner() {
        require(msg.sender == owner, "ArbiToken: caller is not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "ArbiToken: caller is not minter");
        _;
    }

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        _mint(msg.sender, initialSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "ArbiToken: insufficient allowance");
        allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMinter {
        require(balanceOf[from] >= amount, "ArbiToken: burn exceeds balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function setMinter(address minter, bool authorized) external onlyOwner {
        minters[minter] = authorized;
        emit MinterUpdated(minter, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ArbiToken: invalid owner");
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "ArbiToken: transfer from zero");
        require(to != address(0), "ArbiToken: transfer to zero");
        require(balanceOf[from] >= value, "ArbiToken: insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "ArbiToken: mint to zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
