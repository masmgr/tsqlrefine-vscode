-- TSQLLint Demo Query
-- This file demonstrates various T-SQL linting issues that the extension will catch
-- Save this file or enable "runOnType" to see real-time linting in action

-- ============================================================================
-- Example 1: Naming convention violations
-- ============================================================================

-- Table names should follow naming conventions (e.g., use underscores)
CREATE TABLE UserProfile (
    UserID INT PRIMARY KEY,
    FirstName NVARCHAR(100),
    LastName NVARCHAR(100)
);
go
-- Stored procedure with abbreviated names (common issue)
CREATE PROCEDURE sp_GetUserInfo
    @userID INT
AS
BEGIN
    -- Inconsistent casing and formatting
    select UserID, FirstName, LastName from UserProfile where UserID = @userID
END;

-- ============================================================================
-- Example 2: Query formatting issues
-- ============================================================================

-- Poor formatting: multiple statements on one line
UPDATE UserProfile SET FirstName = 'John' WHERE UserID = 1; DELETE FROM UserProfile WHERE UserID = 2;

-- Inconsistent indentation and casing
SELECT
UserID,
    FirstName,
        LastName
FROM UserProfile
WHERE
UserID > 0;

-- ============================================================================
-- Example 3: Non-Standard data types
-- ============================================================================

-- Using deprecated data types
CREATE TABLE Orders (
    OrderID INT,
    OrderDate DATETIME,  -- Consider using DATETIME2
    Amount MONEY,        -- Consider using DECIMAL
    Description TEXT     -- TEXT is deprecated
);

-- ============================================================================
-- Example 4: Missing schema qualifier
-- ============================================================================

-- Should use fully qualified names
SELECT * FROM UserProfile;

-- ============================================================================
-- Example 5: Uppercase/lowercase consistency
-- ============================================================================

-- Mixed case keywords
SeLeCt TOP 10 * FrOm UserProfile oRdEr bY UserID;

-- ============================================================================
-- Example 6: JOIN Best Practices
-- ============================================================================

-- Missing JOIN conditions or implicit joins
SELECT u.UserID, o.OrderID
FROM UserProfile u, Orders o
WHERE u.UserID = o.OrderID;

-- Not using table aliases
SELECT UserProfile.UserID, Orders.OrderID
FROM UserProfile
INNER JOIN Orders ON UserProfile.UserID = Orders.OrderID;

-- ============================================================================
-- Example 7: Cursor usage (often flagged as inefficient)
-- ============================================================================

-- Cursors should generally be avoided for performance
DECLARE @UserID INT;
DECLARE UserCursor CURSOR FOR
    SELECT UserID FROM UserProfile;
OPEN UserCursor;
FETCH NEXT FROM UserCursor INTO @UserID;
CLOSE UserCursor;
DEALLOCATE UserCursor;

-- ============================================================================
-- Example 8: Common best practices
-- ============================================================================

-- Well-formatted query with best practices
SELECT TOP (100)
    u.UserID,
    u.FirstName,
    u.LastName,
    o.OrderID,
    o.OrderDate
FROM dbo.UserProfile AS u
INNER JOIN dbo.Orders AS o
    ON u.UserID = o.OrderID
WHERE u.UserID > 0
ORDER BY u.UserID ASC;

-- ============================================================================
-- Example 9: Variable declarations and naming
-- ============================================================================

DECLARE @user_id INT = 1;           -- Good: snake_case
DECLARE @userId INT = 2;            -- Also acceptable
DECLARE @uid INT = 3;               -- Poor: too abbreviated
DECLARE @result NVARCHAR(MAX) = ''; -- Good

-- ============================================================================
-- Example 10: Stored procedure with parameters
-- ============================================================================
go
CREATE PROCEDURE dbo.sp_GetUserOrders
    @UserId INT,
    @MaxResults INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@MaxResults)
        UserID,
        OrderID,
        OrderDate
    FROM dbo.Orders
    WHERE UserID = @UserId
    ORDER BY OrderDate DESC;
END;
